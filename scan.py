"""Stage 1: scan for BLE devices, highlight likely treadmills, save the chosen one."""
import asyncio
import sys

from bleak import BleakScanner

import config

FTMS_UUID = "00001826-0000-1000-8000-00805f9b34fb"
NAME_HINTS = ("urevo", "spacewalk", "walkingpad", "treadmill", "ur-")


def looks_interesting(name, adv) -> list[str]:
    reasons = []
    if name and any(h in name.lower() for h in NAME_HINTS):
        reasons.append("name")
    if FTMS_UUID in [u.lower() for u in adv.service_uuids]:
        reasons.append("FTMS")
    return reasons


async def main(duration: float) -> None:
    print(f"Scanning for {duration:.0f}s...")
    found = await BleakScanner.discover(timeout=duration, return_adv=True)
    rows = sorted(found.values(), key=lambda t: t[1].rssi, reverse=True)
    for i, (dev, adv) in enumerate(rows):
        name = adv.local_name or dev.name or ""
        flag = ",".join(looks_interesting(name, adv))
        mark = f"  <== {flag}" if flag else ""
        print(f"[{i:2}] {dev.address}  rssi={adv.rssi:4}  {name or '(no name)'}{mark}")
        if flag and adv.service_uuids:
            print(f"       services: {', '.join(adv.service_uuids)}")
    if not rows:
        print("No devices found. Is Bluetooth on?")
        return
    choice = input("\nIndex of the treadmill to save (blank to skip): ").strip()
    if not choice:
        return
    dev, adv = rows[int(choice)]
    cfg = config.load()
    cfg["device_address"] = dev.address
    cfg["device_name"] = adv.local_name or dev.name
    config.save(cfg)
    print(f"Saved {cfg['device_name']} ({dev.address}) to {config.CONFIG_PATH.name}")


if __name__ == "__main__":
    asyncio.run(main(float(sys.argv[1]) if len(sys.argv) > 1 else 10))
