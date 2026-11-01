"""Generates manifest.json, layout and property inspector pages. Run from streamdeck-plugin/."""
import json, os
os.chdir("com.jonny2352.walkingpad.sdPlugin")
P = "com.jonny2352.walkingpad"
acts = [
    ("start", "Start / Resume", "Start or resume the belt. First press arms the key, second press starts (configurable).", "start"),
    ("stop", "Stop (Emergency)", "Stops the belt immediately, no confirmation.", "none"),
    ("pause", "Pause", "Pauses the belt.", "none"),
    ("speed-up", "Speed Up", "Increase speed by a step, within the cap.", "step"),
    ("speed-down", "Speed Down", "Decrease speed by a step.", "step"),
    ("preset", "Set Speed Preset", "Ramp to a fixed speed.", "preset"),
    ("incline-up", "Incline Up", "Increase incline (if supported).", "incline"),
    ("incline-down", "Incline Down", "Decrease incline (if supported).", "incline"),
    ("stat", "Live Stat", "Shows one live metric.", "stat"),
    ("today", "Today's Totals", "Today's distance, time and calories.", "none"),
]
pi = {"start": "ui/start.html", "step": "ui/step.html", "preset": "ui/preset.html", "incline": "ui/incline.html",
      "stat": "ui/stat.html", "none": "ui/backend.html"}
actions = []
for k, name, tip, ui in acts:
    actions.append({"Name": name, "UUID": f"{P}.{k}", "Icon": f"imgs/actions/{k}/icon", "Tooltip": tip,
                    "PropertyInspectorPath": pi[ui], "Controllers": ["Keypad"],
                    "States": [{"Image": f"imgs/actions/{k}/key", "TitleAlignment": "middle", "ShowTitle": False}],
                    "UserTitleEnabled": False})
actions.append({"Name": "Speed Dial (Stream Deck +)", "UUID": f"{P}.dial", "Icon": "imgs/actions/dial/icon",
                "Tooltip": "Rotate to change speed, press to stop.", "PropertyInspectorPath": "ui/dial.html",
                "Controllers": ["Encoder"], "UserTitleEnabled": False,
                "Encoder": {"layout": "layouts/walkingpad.json",
                            "TriggerDescription": {"Rotate": "Change speed", "Push": "Stop belt"},
                            "Icon": "imgs/actions/dial/key"},
                "States": [{"Image": "imgs/actions/dial/key", "TitleAlignment": "middle", "ShowTitle": False}]})
m = {"Name": "Walking Pad", "Version": "0.1.0.0", "Author": "Jonny H", "Actions": actions, "Category": "Walking Pad",
     "CategoryIcon": "imgs/plugin/category-icon", "CodePath": "bin/plugin.js",
     "Description": "Control and monitor the Urevo Spacewalk walking pad through the local Spacewalk backend.",
     "Icon": "imgs/plugin/marketplace", "SDKVersion": 3, "Software": {"MinimumVersion": "7.1"},
     "OS": [{"Platform": "windows", "MinimumVersion": "10"}, {"Platform": "mac", "MinimumVersion": "12"}],
     "Nodejs": {"Version": "24", "Debug": "enabled"}, "UUID": P}
json.dump(m, open("manifest.json", "w"), indent=2)
json.dump({"id": P + ".layout", "items": [
    {"key": "speed", "type": "text", "rect": [8, 6, 184, 56], "font": {"size": 40, "weight": 700}, "alignment": "center"},
    {"key": "time", "type": "text", "rect": [8, 66, 90, 28], "font": {"size": 22}, "alignment": "left"},
    {"key": "distance", "type": "text", "rect": [102, 66, 90, 28], "font": {"size": 22}, "alignment": "right"}]},
    open("layouts/walkingpad.json", "w"), indent=2)


def page(title, body):
    return f'''<!doctype html>
<html>
<head lang="en">
<title>{title}</title>
<meta charset="utf-8" />
<script src="https://sdpi-components.dev/releases/v4/sdpi-components.js"></script>
</head>
<body>
{body}
<sdpi-item label="Backend URL">
<sdpi-textfield setting="backendUrl" global placeholder="http://localhost:8000" default="http://localhost:8000"></sdpi-textfield>
</sdpi-item>
</body>
</html>
'''


def rng(label, setting, lo, hi, step, default):
    return (f'<sdpi-item label="{label}"><sdpi-range setting="{setting}" min="{lo}" max="{hi}" step="{step}" '
            f'default="{default}" showlabels></sdpi-range></sdpi-item>')


pages = {
    "backend": ("Walking Pad", ""),
    "start": ("Start", '<sdpi-item label="Press twice"><sdpi-checkbox setting="arm" default="true" label="First press arms, second starts"></sdpi-checkbox></sdpi-item>'),
    "step": ("Speed step", rng("Step (km/h)", "step", 0.1, 2, 0.1, 0.5)),
    "preset": ("Speed preset", rng("Speed (km/h)", "speed", 1, 6, 0.1, 2)),
    "incline": ("Incline step", rng("Step (%)", "step", 1, 5, 1, 1)),
    "dial": ("Speed dial", rng("Step per tick", "step", 0.1, 0.5, 0.1, 0.1)),
    "stat": ("Live stat", '<sdpi-item label="Metric"><sdpi-select setting="metric" default="speed"><option value="speed">Current speed</option><option value="distance">Distance</option><option value="time">Elapsed time</option><option value="calories">Calories</option><option value="steps">Steps (if available)</option><option value="avg_speed">Session average speed</option><option value="connection">Connection status</option></sdpi-select></sdpi-item>'),
}
for name, (title, body) in pages.items():
    open(f"ui/{name}.html", "w").write(page(title, body))
print("manifest written")
