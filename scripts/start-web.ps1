# Starts the dashboard/backend (web.py) from the project's venv and appends its output to logs\web.log.
# Meant to be run hidden at logon by Task Scheduler (see README, "Run at startup").
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force logs | Out-Null
& "$root\.venv\Scripts\python.exe" web.py 2>&1 | Out-File -Append -Encoding utf8 logs\web.log
