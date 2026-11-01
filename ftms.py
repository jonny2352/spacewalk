"""FTMS Treadmill Data (0x2ACD) decoder. Flags-driven, per Bluetooth FTMS spec 1.0."""
import struct

NA16 = 0xFFFF


def decode_treadmill_data(data: bytes) -> dict:
    """Return a dict of the fields present in one notification. Units: km/h, m, %, kcal, bpm, s."""
    flags = struct.unpack_from("<H", data, 0)[0]
    pos = 2
    out: dict = {"flags": flags}

    def take(fmt: str):
        nonlocal pos
        vals = struct.unpack_from("<" + fmt, data, pos)
        pos += struct.calcsize("<" + fmt)
        return vals

    def u24():
        nonlocal pos
        v = int.from_bytes(data[pos:pos + 3], "little")
        pos += 3
        return v

    if not flags & 0x0001:  # bit 0 is inverted: "More Data"
        out["speed_kmh"] = take("H")[0] / 100
    if flags & 0x0002:
        out["avg_speed_kmh"] = take("H")[0] / 100
    if flags & 0x0004:
        out["distance_m"] = u24()
    if flags & 0x0008:
        incline, ramp = take("hh")
        out["incline_pct"] = incline / 10
        out["ramp_angle_deg"] = ramp / 10
    if flags & 0x0010:
        pos_gain, neg_gain = take("HH")
        out["elevation_gain_m"] = pos_gain / 10
        out["elevation_loss_m"] = neg_gain / 10
    if flags & 0x0020:
        out["pace_kmin"] = take("B")[0] / 10
    if flags & 0x0040:
        out["avg_pace_kmin"] = take("B")[0] / 10
    if flags & 0x0080:
        total, per_hour, per_min = take("HHB")
        if total != NA16:
            out["energy_kcal"] = total
        if per_hour != NA16:
            out["energy_per_hour"] = per_hour
        if per_min != 0xFF:
            out["energy_per_min"] = per_min
    if flags & 0x0100:
        out["heart_rate"] = take("B")[0]
    if flags & 0x0200:
        out["mets"] = take("B")[0] / 10
    if flags & 0x0400:
        out["elapsed_s"] = take("H")[0]
    if flags & 0x0800:
        out["remaining_s"] = take("H")[0]
    if flags & 0x1000:
        force, power = take("hh")
        out["force_n"] = force
        out["power_w"] = power
    return out


# --- Control Point (0x2AD9) -------------------------------------------------
OP_REQUEST_CONTROL = 0x00
OP_SET_SPEED = 0x02
OP_SET_INCLINE = 0x03
OP_START = 0x07
OP_STOP = 0x08
RESULT_NAMES = {1: "success", 2: "not supported", 3: "invalid parameter",
                4: "operation failed", 5: "control not permitted"}
STATUS_NAMES = {0x01: "reset", 0x02: "stopped/paused by user", 0x03: "stopped by safety key",
                0x04: "started/resumed by user", 0x05: "target speed changed",
                0x06: "target incline changed"}


def encode_request_control() -> bytes:
    return bytes([OP_REQUEST_CONTROL])


def encode_start() -> bytes:
    return bytes([OP_START])


def encode_stop() -> bytes:
    return bytes([OP_STOP, 0x01])


def encode_pause() -> bytes:
    return bytes([OP_STOP, 0x02])


def encode_set_speed(kmh: float) -> bytes:
    return struct.pack("<BH", OP_SET_SPEED, round(kmh * 100))


def encode_set_incline(pct: float) -> bytes:
    return struct.pack("<Bh", OP_SET_INCLINE, round(pct * 10))


def parse_cp_response(data: bytes) -> dict:
    """Control Point indication: 0x80, request opcode, result code, optional params."""
    if len(data) < 3 or data[0] != 0x80:
        raise ValueError(f"not a control point response: {data.hex(' ')}")
    return {"opcode": data[1], "result": data[2],
            "result_name": RESULT_NAMES.get(data[2], f"unknown({data[2]})"), "params": data[3:]}


def parse_status(data: bytes) -> dict:
    out = {"code": data[0], "name": STATUS_NAMES.get(data[0], f"unknown({data[0]})")}
    if data[0] == 0x05 and len(data) >= 3:
        out["speed_kmh"] = struct.unpack_from("<H", data, 1)[0] / 100
    elif data[0] == 0x06 and len(data) >= 3:
        out["incline_pct"] = struct.unpack_from("<h", data, 1)[0] / 10
    return out


def decode_incline_range(data: bytes) -> tuple[float, float, float]:
    lo, hi, step = struct.unpack("<hhH", data)
    return lo / 10, hi / 10, step / 10


def decode_speed_range(data: bytes) -> tuple[float, float, float]:
    lo, hi, step = struct.unpack("<HHH", data)
    return lo / 100, hi / 100, step / 100
