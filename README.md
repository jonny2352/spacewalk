# Spacewalk: local BLE app for the Urevo Spacewalk 5L (URTM054)

Connects over Bluetooth LE using the standard FTMS profile, records every sample to SQLite, and controls the belt from a local web dashboard.

**Developed and tested only on one Urevo Spacewalk 5L** (model `URTM054`, firmware V90.08.15), Windows 10 and Windows 11, Python 3.14. The Stream Deck plugin has also been tested. Everything here was verified against that treadmill and nothing else. It moves a real belt, so use it at your own risk and keep the physical stop or remote within reach.

## Other devices
This is not Urevo-specific: it uses the standard Bluetooth Fitness Machine Service (FTMS, 0x1826), not a vendor protocol. These are educated guesses, none tested:

| Likely to work | Why |
|---|---|
| Other Urevo walking pads and treadmills that advertise FTMS (check with `scan.py` / `dump.py`) | Same vendor, probably the same firmware family. Speed range, incline and available fields may differ. |
| Any treadmill from another brand that exposes FTMS Treadmill Data (0x2ACD) and Control Point (0x2AD9) | The decoder follows the FTMS flags, and the speed and incline ranges are read from the device. |

| Unlikely to work | Why |
|---|---|
| Walking pads that only speak a vendor protocol (many Kingsmith/WalkingPad models, and some other budget pads, use one) | There is no FTMS service to talk to, and this app deliberately never writes to unidentified characteristics. |
| Bikes, rowers, ellipticals | They use different FTMS characteristics. |

To check a device, run `python dump.py` (read-only) and look for `FTMS (0x1826) present: YES`. Even then, test cautiously (see `docs/protocol.md` for what was confirmed on the 5L). Pause is still untested there, and the first Start after a Stop sometimes needs a retry. Start with a low `max_speed_kmh`.

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

## Run at startup (for the Stream Deck plugin)
The plugin only talks to the backend, so `web.py` must be running whenever you want the keys to work. On Windows the simplest reliable way is a Task Scheduler task that starts it, hidden, when you log in. Run once in PowerShell from the project folder:

```powershell
$a = New-ScheduledTaskAction -Execute powershell.exe -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PWD\scripts\start-web.ps1`""
$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName SpacewalkBackend -Action $a -Trigger $t -Settings $s
```

Manage it with `Start-ScheduledTask SpacewalkBackend`, `Stop-ScheduledTask SpacewalkBackend` (also needed after editing `config.json`) and `Unregister-ScheduledTask SpacewalkBackend`. Output goes to `logs/web.log`.

Notes:
- Run it as your own user, only while logged in. Do not make it a Windows service or "run whether user is logged on or not": Windows Bluetooth LE access generally needs your desktop session.
- Only one BLE client can connect, so keep the Urevo phone app closed, and do not run `recorder.py` or `controller.py` while the backend is running. The same goes for a `web.py` you started by hand: close it before starting the task, or the two will fight over port 8000 and the Bluetooth connection.
- The treadmill does not need to be on at login. The backend keeps retrying the connection, and the plugin shows keys as offline until it connects.
- Starting the backend never moves the belt. A start still needs an explicit confirmation from the dashboard, or the plugin's armed Start key, after each connect.
- It listens on `127.0.0.1` only, so nothing else on your network can reach it.
- Check it is up with http://127.0.0.1:8000, or look in `logs/web.log` if it is not.

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
