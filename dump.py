"""Stage 2: connect, list services/characteristics, read readable values. Never writes."""
import asyncio
from datetime import datetime
from pathlib import Path

from bleak import BleakClient, BleakScanner

import config

FTMS = "00001826-0000-1000-8000-00805f9b34fb"
OUT = Path(__file__).parent / "docs" / "device-profile.md"


def fmt(data: bytes) -> str:
    text = ""
    if data and all(32 <= b < 127 for b in data):
        text = f'  "{data.decode()}"'
    return f"`{data.hex(' ')}`{text}"


async def main() -> None:
    cfg = config.load()
    if not cfg["device_address"]:
        raise SystemExit("No device saved. Run scan.py first.")
    lines = [
        f"# Device profile: {cfg['device_name']} (XX:XX:XX:XX:XX:XX)",
        f"Captured {datetime.now():%Y-%m-%d %H:%M}. Read-only: no characteristic was written.",
        "",
    ]
    dev = await BleakScanner.find_device_by_address(cfg["device_address"], timeout=15)
    if dev is None:
        raise SystemExit("Treadmill not advertising. Power it on, close the Urevo app, move closer.")
    client = BleakClient(dev, timeout=40)
    for attempt in range(1, 4):
        try:
            await client.connect()
            break
        except (TimeoutError, OSError) as e:
            print(f"connect attempt {attempt} failed: {e!r}")
            if attempt == 3:
                raise
            await asyncio.sleep(2)
    try:
        has_ftms = False
        for svc in client.services:
            has_ftms |= svc.uuid.lower() == FTMS
            lines.append(f"## Service {svc.uuid} ({svc.description})")
            for ch in svc.characteristics:
                props = ",".join(ch.properties)
                lines.append(f"- **{ch.uuid}** ({ch.description}) handle {ch.handle} [{props}]")
                if ch.uuid[4:8] in ("2a23", "2a25"):  # System ID / Serial Number identify the unit: keep out of the saved profile
                    lines.append("  - value: `<redacted>`")
                elif "read" in ch.properties:
                    try:
                        lines.append(f"  - value: {fmt(bytes(await client.read_gatt_char(ch)))}")
                    except Exception as e:
                        lines.append(f"  - read failed: {e}")
            lines.append("")
        lines.append(f"**FTMS (0x1826) present: {'YES' if has_ftms else 'NO'}**")
    finally:
        await client.disconnect()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print(f"\nSaved to {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
