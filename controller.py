"""Stage 4: FTMS Control Point control. Writes only to 0x2AD9, never to vendor characteristics.

Safety: speed is capped (config max_speed_kmh) and ramped in small steps; the belt never starts
without an explicit confirmation per connection; after a disconnect nothing resumes automatically.
"""
import asyncio
import struct
import sys
import time

from bleak import BleakClient, BleakScanner

import config
import ftms

U = "0000{}-0000-1000-8000-00805f9b34fb"
CONTROL_POINT, STATUS, DATA = U.format("2ad9"), U.format("2ada"), U.format("2acd")
FEATURE, SPEED_RANGE, INCLINE_RANGE = U.format("2acc"), U.format("2ad4"), U.format("2ad5")
RAMP_INTERVAL_S = 0.5


class ControlError(Exception):
    pass


class Controller:
    def __init__(self, cfg: dict, confirm_start, log=print, on_data=None, on_event=None):
        self.cfg = cfg
        self.confirm_start = confirm_start  # async callable -> bool; asked before any belt start
        self.log = log
        self.on_data = on_data  # called with (decoded, raw_bytes) for every Treadmill Data notification
        self.on_event = on_event  # called with a short string on status/disconnect
        self.status: str = ""
        self._started = asyncio.Event()
        self.client: BleakClient | None = None
        self.speed_kmh = 0.0  # last measured belt speed
        self.target_kmh = 0.0
        self.has_control = False
        self.start_confirmed = False
        self.paused = False  # set by pause(); cleared by start/stop/reconnect
        self.incline_supported = False
        self.speed_min, self.speed_max, self.speed_step = 1.0, 6.0, 0.1
        self.incline_min, self.incline_max = 0.0, 0.0
        self._pending: asyncio.Future | None = None
        self._lock = asyncio.Lock()
        self._ramp: asyncio.Task | None = None

    # -- connection -------------------------------------------------------
    @property
    def connected(self) -> bool:
        return bool(self.client and self.client.is_connected)

    @property
    def speed_cap(self) -> float:
        return min(self.cfg["max_speed_kmh"], self.speed_max)

    async def connect(self) -> None:
        dev = await BleakScanner.find_device_by_address(self.cfg["device_address"], timeout=15)
        if dev is None:
            raise ControlError("treadmill not advertising")
        self.client = BleakClient(dev, timeout=40, disconnected_callback=self._on_disconnect)
        await self.client.connect()
        # Fresh connection: nothing carries over, belt must be re-confirmed.
        self.has_control = False
        self.start_confirmed = False
        feature = await self.client.read_gatt_char(FEATURE)
        _, targets = struct.unpack("<II", feature)
        self.incline_supported = bool(targets & 0x2)
        self.speed_min, self.speed_max, self.speed_step = ftms.decode_speed_range(
            await self.client.read_gatt_char(SPEED_RANGE))
        self.incline_min, self.incline_max, _ = ftms.decode_incline_range(
            await self.client.read_gatt_char(INCLINE_RANGE))
        await self.client.start_notify(CONTROL_POINT, self._on_cp)
        await self.client.start_notify(STATUS, self._on_status)
        await self.client.start_notify(DATA, self._on_data)
        self.log(f"connected; speed {self.speed_min}-{self.speed_max} km/h, cap {self.speed_cap}")

    def _on_disconnect(self, _client) -> None:
        self.log("DISCONNECTED. Belt will NOT be resumed automatically; reconnect and re-confirm.")
        if self.on_event:
            self.on_event("disconnected")
        self.has_control = False
        self.start_confirmed = False
        self.paused = False
        if self._ramp:
            self._ramp.cancel()

    async def disconnect(self) -> None:
        if self.client:
            await self.client.disconnect()

    # -- notifications ----------------------------------------------------
    def _on_cp(self, _, data: bytearray) -> None:
        try:
            resp = ftms.parse_cp_response(bytes(data))
        except ValueError as e:
            self.log(str(e))
            return
        self.log(f"CP response op=0x{resp['opcode']:02x} {resp['result_name']} {resp['params'].hex()}")
        if self._pending and not self._pending.done():
            self._pending.set_result(resp)

    def _on_status(self, _, data: bytearray) -> None:
        st = ftms.parse_status(bytes(data))
        self.log(f"status: {st}")
        self.status = st["name"]
        if st["code"] == 0x04:
            self._started.set()
        if self.on_event:
            self.on_event(self.status)

    def _on_data(self, _, data: bytearray) -> None:
        raw = bytes(data)
        d = ftms.decode_treadmill_data(raw)
        self.speed_kmh = d.get("speed_kmh", self.speed_kmh)
        if d.get("speed_kmh", 0) > 0:
            self._started.set()
        if self.on_data:
            self.on_data(d, raw)

    # -- procedures -------------------------------------------------------
    async def _send(self, payload: bytes) -> dict:
        if not self.connected:
            raise ControlError("not connected")
        async with self._lock:
            self._pending = asyncio.get_running_loop().create_future()
            self.log(f"CP write {payload.hex(' ')}")
            await self.client.write_gatt_char(CONTROL_POINT, payload, response=True)
            try:
                resp = await asyncio.wait_for(self._pending, 5)
            except asyncio.TimeoutError:
                raise ControlError("no Control Point response within 5s")
        if resp["result"] != 1:
            raise ControlError(f"op 0x{payload[0]:02x} rejected: {resp['result_name']}")
        return resp

    async def request_control(self) -> None:
        await self._send(ftms.encode_request_control())
        self.has_control = True

    async def stop(self) -> None:
        """Always allowed. Cancels any ramp first, and does not require confirmation."""
        if self._ramp:
            self._ramp.cancel()
        if not self.has_control:
            await self.request_control()
        await self._send(ftms.encode_stop())
        self.target_kmh = 0.0
        self.paused = False

    async def pause(self) -> None:
        if self._ramp:
            self._ramp.cancel()
        if not self.has_control:
            await self.request_control()
        await self._send(ftms.encode_pause())
        self.target_kmh = 0.0
        self.paused = True

    async def start(self) -> None:
        if not self.start_confirmed:
            if not await self.confirm_start():
                raise ControlError("start not confirmed")
            self.start_confirmed = True
        if not self.has_control:
            await self.request_control()
        self._started.clear()
        await self._send(ftms.encode_start())
        # On this pad the first Start after a Stop was acknowledged but did not run the belt
        # (observed once). Wait for movement and retry once within the same confirmation.
        try:
            await asyncio.wait_for(self._started.wait(), 4)
        except asyncio.TimeoutError:
            self.log("belt not moving after Start; retrying Start once")
            await self._send(ftms.encode_start())
        self.target_kmh = 0.0
        self.paused = False

    def clamp_speed(self, kmh: float) -> float:
        return round(max(self.speed_min, min(kmh, self.speed_cap)), 2)

    async def set_speed(self, kmh: float, wait: bool = True) -> float:
        """Ramp to kmh in small steps. Returns the (clamped) final speed; wait=False returns at once."""
        if not self.start_confirmed:
            raise ControlError("start the belt first (needs confirmation)")
        goal = self.clamp_speed(kmh)
        running = self._ramp is not None and not self._ramp.done()
        if running:
            self._ramp.cancel()
        # Continue from the last target if a ramp was in flight, else from the measured belt speed.
        start = self.target_kmh if running and self.target_kmh else round(max(self.speed_kmh, self.speed_min), 2)
        self._ramp = asyncio.create_task(self._ramp_to(goal, start))
        self._ramp.add_done_callback(self._ramp_done)
        if wait:
            try:
                await self._ramp
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise
        return goal

    def _ramp_done(self, task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception():
            self.log(f"ramp failed: {task.exception()}")

    async def _ramp_to(self, goal: float, cur: float) -> None:
        step = max(self.cfg["speed_step_kmh"], self.speed_step)
        while abs(goal - cur) > 1e-6:
            cur = round(min(cur + step, goal) if goal > cur else max(cur - step, goal), 2)
            await self._send(ftms.encode_set_speed(cur))
            self.target_kmh = cur
            await asyncio.sleep(RAMP_INTERVAL_S)

    async def set_incline(self, pct: float) -> None:
        if not self.incline_supported:
            raise ControlError("incline target not supported (Feature flags)")
        pct = max(self.incline_min, min(pct, self.incline_max))
        await self._send(ftms.encode_set_incline(pct))


async def ask_confirm() -> bool:
    print("\n*** The belt will START MOVING. Stand clear of the belt and keep the physical")
    print("*** stop button or remote within reach.")
    ans = await asyncio.to_thread(input, "Type START to confirm: ")
    return ans.strip() == "START"


HELP = ("commands: start | stop | pause | speed <kmh> | incline <pct> | cap | "
        "selftest | help | quit   (empty line or 's' = EMERGENCY STOP)")


async def repl() -> None:
    cfg = config.load()
    if not cfg["device_address"]:
        raise SystemExit("No device saved. Run scan.py first.")
    c = Controller(cfg, ask_confirm)
    await c.connect()
    print(HELP)
    try:
        while True:
            line = (await asyncio.to_thread(input, "> ")).strip().lower()
            cmd, _, arg = line.partition(" ")
            try:
                if cmd in ("", "s"):
                    await c.stop()
                elif cmd == "quit":
                    break
                elif cmd == "help":
                    print(HELP)
                elif cmd == "cap":
                    print(f"cap {c.speed_cap} km/h (config {cfg['max_speed_kmh']}, device max {c.speed_max})")
                elif cmd == "start":
                    await c.start()
                elif cmd == "stop":
                    await c.stop()
                elif cmd == "pause":
                    await c.pause()
                elif cmd == "speed":
                    print(f"speed set to {await c.set_speed(float(arg))} km/h")
                elif cmd == "incline":
                    await c.set_incline(float(arg))
                elif cmd == "selftest":
                    # Stop-first test: harmless on an idle belt, stops it if running.
                    await c.request_control()
                    await c.stop()
                    print("selftest ok: Request Control + Stop accepted")
                else:
                    print(HELP)
            except (ControlError, ValueError) as e:
                print(f"error: {e}")
            if not c.connected:
                print("connection lost; not resuming. Restart to reconnect.")
                break
    except (KeyboardInterrupt, EOFError):
        pass
    finally:
        if c.connected:
            try:
                await c.stop()
            except Exception:
                pass
        await c.disconnect()


if __name__ == "__main__":
    asyncio.run(repl())
