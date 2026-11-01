"""Stage 3: subscribe to Treadmill Data, decode, print and record. Read-only: sends no commands."""
import asyncio
import sys
import time

from bleak import BleakClient, BleakScanner

import config
from ftms import decode_treadmill_data
from storage import Storage

TREADMILL_DATA = "00002acd-0000-1000-8000-00805f9b34fb"


class Recorder:
    """Session logic: a session starts when the belt moves and ends after idle_timeout_s of no movement."""

    def __init__(self, storage: Storage, idle_timeout_s: float, on_sample=None):
        self.storage = storage
        self.idle_timeout_s = idle_timeout_s
        self.on_sample = on_sample
        self.session_id: int | None = None
        self.last_moving = 0.0

    def handle(self, raw: bytes, now: float | None = None) -> dict | None:
        now = now or time.time()
        try:
            decoded = decode_treadmill_data(raw)
        except Exception as e:  # keep the raw bytes even if decoding is wrong
            print(f"decode error {e!r}: {raw.hex(' ')}")
            return None
        moving = decoded.get("speed_kmh", 0) > 0
        if moving:
            self.last_moving = now
            if self.session_id is None:
                self.session_id = self.storage.start_session(now)
                print(f"--- session {self.session_id} started")
        if self.session_id is not None:
            self.storage.add_sample(self.session_id, now, decoded, raw)
            if not moving and now - self.last_moving >= self.idle_timeout_s:
                self.close(now)
        if self.on_sample:
            self.on_sample(decoded, self.session_id)
        return decoded

    def close(self, now: float | None = None) -> None:
        if self.session_id is not None:
            self.storage.end_session(self.session_id, now)
            print(f"--- session {self.session_id} ended")
            self.session_id = None


def show(decoded: dict, session_id) -> None:
    keys = ("speed_kmh", "distance_m", "incline_pct", "energy_kcal", "heart_rate", "elapsed_s")
    parts = [f"{k}={decoded[k]}" for k in keys if k in decoded]
    print(f"[s{session_id}] " + "  ".join(parts))


async def run(cfg: dict, rec: Recorder) -> None:
    """Connect and record; on disconnect, log and retry. Never sends anything to the treadmill."""
    while True:
        dev = await BleakScanner.find_device_by_address(cfg["device_address"], timeout=15)
        if dev is None:
            print("treadmill not found, retrying...")
            continue
        gone = asyncio.Event()
        client = BleakClient(dev, timeout=40, disconnected_callback=lambda c: gone.set())
        try:
            await client.connect()
            print("connected")
            await client.start_notify(TREADMILL_DATA, lambda _, d: rec.handle(bytes(d)))
            await gone.wait()
            print("DISCONNECTED")
        except (TimeoutError, OSError) as e:
            print(f"connect failed: {e!r}")
        finally:
            rec.close()
            if client.is_connected:
                await client.disconnect()
        await asyncio.sleep(3)


async def main() -> None:
    cfg = config.load()
    if not cfg["device_address"]:
        raise SystemExit("No device saved. Run scan.py first.")
    rec = Recorder(Storage(cfg["db_path"]), cfg["idle_timeout_s"], show)
    await run(cfg, rec)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "export":
        print(Storage(config.load()["db_path"]).export_csv(int(sys.argv[2])), end="")
    else:
        try:
            asyncio.run(main())
        except KeyboardInterrupt:
            pass
