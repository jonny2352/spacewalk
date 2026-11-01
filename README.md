# Spacewalk: local BLE app for the Urevo Spacewalk 5L (URTM054)

Connects over Bluetooth LE using the standard FTMS profile, records every sample to SQLite, and controls the belt from a local web dashboard. Tested on Windows 10 with the built-in adapter, Python 3.14.

## Setup
```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Linux/macOS: .venv/bin/pip
.venv/Scripts/python scan.py                      # pick your treadmill, saved to config.json
```
Power the treadmill on and fully close the Urevo phone app first: it accepts one BLE client at a time. If the first connect times out on Windows, just retry (the scripts scan before connecting).

## Run
| Command | What it does |
|---|---|
| `python scan.py` | List BLE devices, highlight FTMS/Urevo, save your choice |
| `python dump.py` | Read-only GATT dump to `docs/device-profile.md` |
| `python recorder.py` | Live terminal view and recording (sends no commands) |
| `python recorder.py export <id>` | Print a session as CSV |
| `python controller.py` | Terminal control: start/stop/pause/speed/incline, empty line = emergency stop |
| `python web.py` | Dashboard at http://127.0.0.1:8000 (localhost only) |

Only one of recorder, controller and web can run at a time. The dashboard does both recording and control.

## Config (`config.json`)
`max_speed_kmh` (speed cap; default 6.0, the pad's maximum; lower it to be safer), `idle_timeout_s` (60, ends a session), `speed_step_kmh` (0.1 ramp step), `db_path`.

## Safety
Speed is capped and ramped in 0.1 km/h steps. Starting the belt always needs an explicit confirmation (typing `START`, or the dialog in the UI), and again after any reconnect. A dropped connection never resumes the belt. Stop (button, Space, Esc, or an empty line in the terminal) is always available. Nothing is ever written to the vendor-specific characteristics.

## Tests
`python -m pytest`. See `docs/protocol.md` for confirmed commands and quirks.

## Backend API (used by the web dashboard and the Stream Deck plugin)
Bound to 127.0.0.1 only, no auth. Port from `config.json` (`port`, default 8000).

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | Snapshot: `connected`, `state` (offline/idle/running/paused), `target_kmh`, `cap`, `speed_min`, `incline_supported`, `incline_max`, `live` (empty when the pad is disconnected), `avg_speed_kmh` |
| `WS /ws` | Pushes the same snapshot on every sample and status change |
| `GET /api/today` | Today's distance, seconds and kcal from stored sessions |
| `POST /api/start` `{confirmed:true}`, `/api/stop`, `/api/pause`, `/api/speed {kmh}`, `/api/incline {pct}` | Commands; rejections return HTTP 409 with `detail` |

Stream Deck plugin: see `streamdeck-plugin/README.md`.
