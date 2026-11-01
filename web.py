"""Stage 5: local web dashboard. One BLE connection shared by the controller and the recorder.

Run: python web.py   (serves http://127.0.0.1:8000, localhost only)
"""
import asyncio
import contextlib
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel

import config
from controller import ControlError, Controller
from recorder import Recorder
from storage import Storage

STATIC = Path(__file__).parent / "static"
cfg = config.load()
storage = Storage(cfg["db_path"])
clients: set[WebSocket] = set()
logs: list[str] = []
live: dict = {}


def log(msg: str) -> None:
    print(msg)
    logs.append(msg)
    del logs[:-30]
    push()


async def never_confirm() -> bool:
    return False  # the UI sets start_confirmed itself, after its own confirmation dialog


def snapshot() -> dict:
    """Full state for the dashboard and other clients (e.g. the Stream Deck plugin).

    `live` is empty whenever the treadmill is disconnected, so clients never show stale data.
    `state` is offline | idle | running | paused.
    """
    connected = ctrl.connected
    cur = live if connected else {}
    speed = cur.get("speed_kmh", 0) or 0
    state = "offline" if not connected else "running" if speed > 0 else "paused" if ctrl.paused else "idle"
    avg = None
    if cur.get("elapsed_s") and cur.get("distance_m") is not None:
        avg = round(cur["distance_m"] / cur["elapsed_s"] * 3.6, 2)
    return {
        "connected": connected, "state": state, "status": ctrl.status, "target_kmh": ctrl.target_kmh,
        "cap": ctrl.speed_cap, "speed_min": ctrl.speed_min, "speed_step": ctrl.speed_step,
        "incline_supported": ctrl.incline_supported,
        "incline_max": ctrl.incline_max if ctrl.incline_supported else 0,
        "session_id": rec.session_id, "live": cur, "avg_speed_kmh": avg,
        "server_time": time.time(), "log": logs[-8:],
    }


def push() -> None:
    for ws in list(clients):
        asyncio.get_running_loop().create_task(send(ws))


async def send(ws: WebSocket) -> None:
    try:
        await ws.send_json(snapshot())
    except Exception:
        clients.discard(ws)


def on_data(decoded: dict, raw: bytes) -> None:
    live.update(decoded, ts=time.time())
    rec.handle(raw)
    push()


def on_event(name: str) -> None:
    if name == "disconnected":
        live.clear()
    push()


ctrl = Controller(cfg, never_confirm, log=log, on_data=on_data, on_event=on_event)
rec = Recorder(storage, cfg["idle_timeout_s"])


async def supervisor() -> None:
    """Keep the connection up. Reconnecting never restarts the belt."""
    while True:
        try:
            if not ctrl.connected:
                await ctrl.connect()
                push()
            await asyncio.sleep(2)
        except Exception as e:
            log(f"connect failed: {e!r}")
            rec.close()
            await asyncio.sleep(5)
        if not ctrl.connected:
            rec.close()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(supervisor())
    yield
    task.cancel()
    rec.close()
    if ctrl.connected:
        with contextlib.suppress(Exception):
            await ctrl.stop()
        await ctrl.disconnect()


app = FastAPI(lifespan=lifespan)


class StartBody(BaseModel):
    confirmed: bool = False


class SpeedBody(BaseModel):
    kmh: float


class InclineBody(BaseModel):
    pct: float


async def run(coro):
    try:
        return await coro
    except ControlError as e:
        log(f"error: {e}")
        raise HTTPException(409, str(e))


@app.post("/api/start")
async def start(body: StartBody):
    if not body.confirmed:
        raise HTTPException(400, "start must be confirmed")
    ctrl.start_confirmed = True
    await run(ctrl.start())
    return {"ok": True}


@app.post("/api/stop")
async def stop():
    await run(ctrl.stop())
    return {"ok": True}


@app.post("/api/pause")
async def pause():
    await run(ctrl.pause())
    return {"ok": True}


@app.post("/api/speed")
async def speed(body: SpeedBody):
    return {"target": await run(ctrl.set_speed(body.kmh, wait=False))}


@app.post("/api/incline")
async def incline(body: InclineBody):
    await run(ctrl.set_incline(body.pct))
    return {"ok": True}


@app.get("/api/state")
def state():
    return snapshot()


@app.get("/api/today")
def today():
    return storage.today()


@app.get("/api/sessions")
def sessions():
    return storage.sessions()


@app.get("/api/sessions/{sid}")
def session_detail(sid: int):
    return {"samples": [{k: s[k] for k in ("ts", "speed_kmh", "distance_m", "incline_pct",
                                          "energy_kcal", "elapsed_s")} for s in storage.samples(sid)]}


@app.get("/api/sessions/{sid}.csv")
def session_csv(sid: int):
    return PlainTextResponse(storage.export_csv(sid), media_type="text/csv", headers={
        "Content-Disposition": f"attachment; filename=session-{sid}.csv"})


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    await send(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        clients.discard(ws)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


if __name__ == "__main__":
    if not cfg["device_address"]:
        raise SystemExit("No device saved. Run scan.py first.")
    uvicorn.run(app, host="127.0.0.1", port=cfg["port"], log_level="warning")
