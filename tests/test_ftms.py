import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from ftms import decode_speed_range, decode_treadmill_data
from recorder import Recorder
from storage import Storage


def test_speed_range_from_device():
    # Captured from URTM054
    assert decode_speed_range(bytes.fromhex("640058020a00")) == (1.0, 6.0, 0.1)


def test_speed_only():
    d = decode_treadmill_data(bytes.fromhex("0000" "2c01"))
    assert d["speed_kmh"] == 3.0


def test_more_data_bit_omits_speed():
    assert "speed_kmh" not in decode_treadmill_data(bytes.fromhex("0100"))


def test_full_packet():
    # flags: distance, incline, energy, hr, elapsed = 0x04|0x08|0x80|0x100|0x400 = 0x58c
    raw = bytes.fromhex("8c05" "f401" "e80300" "1400" "0000" "0a00" "ffff" "ff" "48" "5802")
    d = decode_treadmill_data(raw)
    assert d["speed_kmh"] == 5.0
    assert d["distance_m"] == 1000
    assert d["incline_pct"] == 2.0
    assert d["energy_kcal"] == 10
    assert "energy_per_hour" not in d
    assert d["heart_rate"] == 72
    assert d["elapsed_s"] == 600


def test_real_urtm054_packet():
    # Captured from the device at 1.0 km/h; flags 0x259c, 2 trailing bytes for undefined bit 13
    raw = bytes.fromhex("9c25640014000000000000000000000200000000004a00000000")
    d = decode_treadmill_data(raw)
    assert (d["speed_kmh"], d["distance_m"], d["energy_kcal"], d["elapsed_s"]) == (1.0, 20, 2, 74)
    assert d["heart_rate"] == 0


def test_session_lifecycle(tmp_path):
    st = Storage(tmp_path / "t.db")
    rec = Recorder(st, idle_timeout_s=10)
    moving = bytes.fromhex("00002c01")
    stopped = bytes.fromhex("00000000")
    rec.handle(stopped, now=100)
    assert rec.session_id is None
    rec.handle(moving, now=101)
    sid = rec.session_id
    rec.handle(stopped, now=105)
    assert rec.session_id == sid
    rec.handle(stopped, now=112)
    assert rec.session_id is None
    assert len(st.samples(sid)) == 3
    assert st.samples(sid)[0]["raw_hex"] == "00002c01"
    assert st.export_csv(sid).startswith("ts,speed_kmh")


def test_control_point_encoding():
    from ftms import (encode_pause, encode_request_control, encode_set_incline,
                      encode_set_speed, encode_start, encode_stop)
    assert encode_request_control() == b"\x00"
    assert encode_start() == b"\x07"
    assert encode_stop() == b"\x08\x01"
    assert encode_pause() == b"\x08\x02"
    assert encode_set_speed(2.5) == bytes.fromhex("02fa00")
    assert encode_set_incline(-1.5) == bytes.fromhex("03f1ff")


def test_control_point_parsing():
    from ftms import parse_cp_response, parse_status
    r = parse_cp_response(bytes.fromhex("800701"))
    assert (r["opcode"], r["result_name"]) == (7, "success")
    assert parse_cp_response(bytes.fromhex("800205"))["result_name"] == "control not permitted"
    assert parse_status(bytes.fromhex("05fa00"))["speed_kmh"] == 2.5
    assert parse_status(bytes.fromhex("0201"))["name"] == "stopped/paused by user"


def test_ramp_and_cap():
    import asyncio
    import controller
    controller.RAMP_INTERVAL_S = 0
    sent = []
    c = controller.Controller({"max_speed_kmh": 3.0, "speed_step_kmh": 0.5}, None, log=lambda *_: None)
    c.start_confirmed = True

    async def fake_send(payload):
        sent.append(payload)
    c._send = fake_send
    assert c.clamp_speed(9) == 3.0 and c.clamp_speed(0.2) == c.speed_min
    asyncio.run(c.set_speed(9))
    speeds = [int.from_bytes(p[1:], "little") / 100 for p in sent]
    assert speeds == [1.5, 2.0, 2.5, 3.0]  # small steps, never above the cap


def test_today_totals(tmp_path):
    import time
    from storage import Storage
    st = Storage(tmp_path / "t.db")
    now = time.time()
    sid = st.start_session(now - 600)
    st.add_sample(sid, now - 300, {"distance_m": 400, "energy_kcal": 20}, b"\x00")
    st.end_session(sid, now - 100)
    old = st.start_session(now - 3 * 86400)
    st.add_sample(old, now - 3 * 86400 + 5, {"distance_m": 999}, b"\x00")
    st.end_session(old, now - 3 * 86400 + 10)
    assert st.today() == {"distance_m": 400, "seconds": 500, "kcal": 20}


# --- localhost guard -------------------------------------------------------------------------
def _call(kind, headers):
    import asyncio
    import security

    sent, reached = [], []

    async def inner(scope, receive, send):
        reached.append(True)

    async def receive():
        return {"type": "websocket.connect"}

    async def send(m):
        sent.append(m)

    scope = {"type": kind, "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
    asyncio.run(security.LocalOnly(inner)(scope, receive, send))
    return bool(reached), sent


def test_local_requests_pass():
    for h in ({"host": "127.0.0.1:8000"}, {"host": "localhost:8000", "origin": "http://localhost:8000"},
              {"host": "[::1]:8000"}, {"host": "127.0.0.1:8000", "origin": "http://127.0.0.1:8000"}):
        assert _call("http", h)[0] and _call("websocket", h)[0], h


def test_foreign_host_or_origin_rejected():
    for h in ({"host": "evil.example:8000"},                                   # DNS rebinding
              {"host": "127.0.0.1:8000", "origin": "https://evil.example"},    # cross-site page
              {"host": "127.0.0.1:8000", "origin": "http://127.0.0.1.evil.example"},
              {}):                                                              # no Host at all
        reached, sent = _call("http", h)
        assert not reached and sent[0]["status"] == 403, h
        reached, sent = _call("websocket", h)
        assert not reached and sent[0]["type"] == "websocket.close", h
