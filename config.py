"""Shared config load/save. Stored in config.json next to this file."""
import json
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / "config.json"

DEFAULTS = {
    "device_address": None,
    "device_name": None,
    "max_speed_kmh": 6.0,
    "idle_timeout_s": 60,
    "speed_step_kmh": 0.1,
    "db_path": "spacewalk.db",
    "port": 8000,
}


def load() -> dict:
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text()))
    return cfg


def save(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")
