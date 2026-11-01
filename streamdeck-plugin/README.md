# Walking Pad: Stream Deck plugin

Controls the Urevo Spacewalk through the local backend (`python web.py`). The plugin never talks Bluetooth itself; only one BLE client can connect, and that is the backend. It is a thin client: live state over WebSocket (`ws://localhost:8000/ws`), commands over HTTP.

Versions used: Stream Deck SDK `@elgato/streamdeck` 3.0.4 (manifest `SDKVersion` 3), `@elgato/cli` 1.10.4, Node.js 24 (the SDK requires 24+), Stream Deck app 7.1 or newer.

## Install
Double-click `dist/com.jonny2352.walkingpad.streamDeckPlugin` (needs the Stream Deck app). Start the backend (`python web.py`), then drag actions from the "Walking Pad" category onto keys.

## Development
```bash
cd streamdeck-plugin
npm install
npm run build            # bundle to com.jonny2352.walkingpad.sdPlugin/bin
npx streamdeck link com.jonny2352.walkingpad.sdPlugin   # once: link into the Stream Deck app
npm run watch            # rebuild and restart the plugin on change
npm test                 # unit tests (formatting and backend client)
npx streamdeck pack com.jonny2352.walkingpad.sdPlugin -o dist --force
npm run mock 8000        # fake backend, no treadmill needed (stop the real one first)
```
Logs: `%APPDATA%\Elgato\StreamDeck\logs` (macOS: `~/Library/Logs/ElgatoStreamDeck`) and the plugin's own `com.jonny2352.walkingpad.sdPlugin/logs`.
`npm run icons` and `python scripts/make-manifest.py` regenerate the images, manifest and property inspector pages.

## Configuration
Every key's property inspector has a **Backend URL** (global, default `http://localhost:8000`; match `port` in the backend `config.json`). Per-key settings:

| Action | Settings |
|---|---|
| Start / Resume | "First press arms, second starts" (on by default; armed state lasts 3 s and flashes) |
| Speed Up / Down | step in km/h (default 0.5) |
| Set Speed Preset | speed in km/h |
| Incline Up / Down | step in % (default 1) |
| Live Stat | speed, distance, time, calories, steps (N/A on this pad), session average speed, connection status |
| Speed Dial | step per tick (default 0.1) |

## Actions
Start/Resume, Stop (emergency, red, never confirms), Pause, Speed Up, Speed Down, Set Speed Preset, Incline Up/Down (shows N/A if the backend reports no incline), Live Stat, Today's Totals (distance, time, kcal from stored sessions), and a Speed Dial for Stream Deck + (rotate = speed within cap, press = stop, touch strip shows speed/time/distance). The dial layout is unverified on hardware.

## Safety behaviour
- The backend remains the authority: speed cap, 0.1 km/h ramping and range limits are enforced there. A rejected command shows the alert indicator and is logged.
- Nothing starts the belt on plugin load or reconnect, and nothing is queued or replayed while offline.
- Stop is always attempted (even when the plugin thinks it is offline) and bypasses the rate limiter. Other commands are limited to one per 150 ms and dropped, not queued, if faster.
- Data older than 10 s, a dropped WebSocket, or a disconnected treadmill all turn keys to "offline"; stale values are never shown.
- Speed, pause and preset keys only act while the belt is running. With "arm" off, a single Start press starts the belt, so keep the physical stop or remote within reach.

## Suggested layouts
15-key (3 rows of 5):

| | | | | |
|---|---|---|---|---|
| Start | Pause | **Stop** | Speed (stat) | Time (stat) |
| Speed − | Speed + | Preset 2.0 | Distance (stat) | Calories (stat) |
| Incline − | Incline + | Preset 3.0 | Today | Connection (stat) |

6-key (2 rows of 3):

| | | |
|---|---|---|
| Start | **Stop** | Speed (stat) |
| Speed − | Speed + | Time (stat) |

## Troubleshooting
- All keys say "offline": is `python web.py` running, and is the Backend URL right? Open the URL in a browser. The Urevo phone app must be closed and the pad powered on.
- Keys go offline for a few seconds after the pad drops: the backend reconnects on its own; the belt is never resumed.
- Property inspector blank: it loads `sdpi-components` from sdpi-components.dev, so it needs internet access.
