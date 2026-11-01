# Protocol notes: UREVO URTM054 (Spacewalk 5L)

Status: CONFIRMED = read from the real device on 2026-11-01. UNCONFIRMED = from spec/references only.

## Device (CONFIRMED)
- Advertised name/model `URTM054`, manufacturer `UREVO`, firmware V90.08.15, hardware V002, software V03.01.03.
- Address `XX:XX:XX:XX:XX:XX`. Needed a scan-first connect and ~40s timeout on Windows (first direct connect timed out during service discovery).

## FTMS 0x1826 present (CONFIRMED)
| Characteristic | UUID | Props | Notes |
|---|---|---|---|
| Fitness Machine Feature | 2ACC | read | `5c 16 00 00 03 00 00 00` |
| Treadmill Data | 2ACD | notify | decoder verified against live bytes (see `tests/test_ftms.py`) |
| Training Status | 2AD3 | notify, read | `01 01` (idle) |
| Supported Speed Range | 2AD4 | read | `64 00 58 02 0a 00` |
| Supported Inclination Range | 2AD5 | read | `00 00 5a 00 0a 00` |
| Supported HR Range | 2AD7 | read | `28 f0 01` |
| Control Point | 2AD9 | write, indicate | used for all control, see below |
| Machine Status | 2ADA | notify | |

### Decoded values (CONFIRMED from the bytes above, by spec)
- Feature field 0x0000165C: total distance, inclination, elevation gain, step count, expended energy, heart rate, elapsed time. No average speed, pace, power.
- Target settings 0x00000003: speed target and inclination target supported.
- Speed range: min 1.00 km/h, max 6.00 km/h, step 0.10 km/h.
- Inclination range: 0.0 to 9.0 %, step 1.0 % (the 5L does physically incline, up to 9 %).

## Vendor-specific services (UNIDENTIFIED: do not write)
- `fff0`: `fff1` notify, `fff2` write.
- `fee0`: `fee1` notify, `fee2` write.
- `5833ff01-9b8b-5191-6142-22a4536ef123`: `ff02` write, `ff03` notify.
Purpose unknown. Per the safety rules, nothing is sent to these.

## Treadmill Data live capture (CONFIRMED, 2026-11-01)
- Notifications arrive about once per second, 26 bytes, flags `0x259c`.
- Sample (1.0 km/h): `9c 25 64 00 14 00 00 00 00 00 00 00 00 00 00 00 02 00 00 00 00 00 4a 00 00 00 00`
- Present fields: speed, total distance (m), inclination + ramp, elevation gain, energy (total/hour/min), heart rate, elapsed time. These decode correctly (elapsed counts up 1/s, distance matches speed).
- Flag bit 13 (0x2000) is not defined in FTMS 1.0; it carries 2 trailing bytes, always `00 00` so far. Ignored by the decoder; raw bytes are stored in SQLite. UNCONFIRMED meaning.
- Heart rate reads 0 without a strap.
- Distance only updates every few seconds (20 m at 74 s, 1.0 km/h).

## Control Point (CONFIRMED on the 5L)
Opcodes per FTMS spec: `00` Request Control, `07` Start/Resume, `08 01` Stop, `08 02` Pause, `02 <u16 0.01 km/h>` Set Target Speed, `03 <s16 0.1 %>` Set Target Incline. Responses are indications `80 <opcode> <result>` (1 = success). Vendor quirks from the reference projects (pre-amble, wait for belt speed > 0 before target speed) are NOT applied; none were needed on this device.

### Control Point results on URTM054 (2026-11-01)
- `00` Request Control -> `80 00 01` success (CONFIRMED)
- `08 01` Stop -> `80 08 01` success (CONFIRMED)
- `07` Start -> `80 07 01` success (CONFIRMED accepted). QUIRK (cause UNCONFIRMED): the first Start after Request Control + Stop returned success but the pad then sent Status `02` (stopped/paused by user); a second Start produced Status `04` (started/resumed by user). The controller now waits for belt movement after Start and retries Start once; this retry has been tested on the device. Before that, Status `03` (stopped by safety key) followed the earlier Stop.
- `02 <u16>` Set Target Speed, 10 steps of 0.1 km/h from 1.1 to 2.0 km/h, every step -> success (CONFIRMED accepted; belt speed follows in Treadmill Data).
- `03 14 00` Set Target Incline 2.0 % -> success (CONFIRMED; the belt inclines, up to 9 %).
- `08 01` Stop while running -> success, then Status `02` (CONFIRMED).
- Pause (`08 02`) -> works (CONFIRMED by testing from the dashboard and Stream Deck).
- Reconnect after a dropped connection: the backend retries and the belt is never resumed automatically (CONFIRMED by testing).
