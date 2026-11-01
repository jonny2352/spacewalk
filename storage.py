"""SQLite storage for sessions and samples, plus CSV export."""
import csv
import io
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,
    ended_at REAL
);
CREATE TABLE IF NOT EXISTS samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    ts REAL NOT NULL,
    speed_kmh REAL,
    distance_m INTEGER,
    incline_pct REAL,
    energy_kcal INTEGER,
    heart_rate INTEGER,
    elapsed_s INTEGER,
    raw_hex TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS samples_session ON samples(session_id, ts);
"""

COLUMNS = ["ts", "speed_kmh", "distance_m", "incline_pct", "energy_kcal",
           "heart_rate", "elapsed_s", "raw_hex"]


class Storage:
    def __init__(self, path: str | Path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        # A crash leaves sessions open; close them at their last sample.
        self.db.execute(
            "UPDATE sessions SET ended_at = COALESCE((SELECT MAX(ts) FROM samples "
            "WHERE session_id = sessions.id), started_at) WHERE ended_at IS NULL")
        self.db.commit()

    def start_session(self, ts: float | None = None) -> int:
        cur = self.db.execute("INSERT INTO sessions(started_at) VALUES (?)", (ts or time.time(),))
        self.db.commit()
        return cur.lastrowid

    def end_session(self, session_id: int, ts: float | None = None) -> None:
        self.db.execute("UPDATE sessions SET ended_at = ? WHERE id = ?", (ts or time.time(), session_id))
        self.db.commit()

    def add_sample(self, session_id: int, ts: float, decoded: dict, raw: bytes) -> None:
        self.db.execute(
            "INSERT INTO samples(session_id, ts, speed_kmh, distance_m, incline_pct, "
            "energy_kcal, heart_rate, elapsed_s, raw_hex) VALUES (?,?,?,?,?,?,?,?,?)",
            (session_id, ts, decoded.get("speed_kmh"), decoded.get("distance_m"),
             decoded.get("incline_pct"), decoded.get("energy_kcal"), decoded.get("heart_rate"),
             decoded.get("elapsed_s"), raw.hex()))
        self.db.commit()

    def sessions(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT s.*, (SELECT COUNT(*) FROM samples WHERE session_id = s.id) AS n_samples, "
            "(SELECT MAX(distance_m) FROM samples WHERE session_id = s.id) AS distance_m "
            "FROM sessions s ORDER BY s.id DESC").fetchall()
        return [dict(r) for r in rows]

    def today(self) -> dict:
        """Totals over sessions that started since local midnight."""
        midnight = time.mktime(time.localtime()[:3] + (0, 0, 0, 0, 0, -1))
        dist = secs = kcal = 0
        for s in self.sessions():
            if s["started_at"] < midnight:
                continue
            row = self.db.execute("SELECT MAX(distance_m), MAX(energy_kcal), MAX(ts) FROM samples "
                                  "WHERE session_id = ?", (s["id"],)).fetchone()
            dist += row[0] or 0
            kcal += row[1] or 0
            secs += (s["ended_at"] or row[2] or s["started_at"]) - s["started_at"]
        return {"distance_m": dist, "seconds": round(secs), "kcal": kcal}

    def samples(self, session_id: int) -> list[dict]:
        rows = self.db.execute("SELECT * FROM samples WHERE session_id = ? ORDER BY ts", (session_id,))
        return [dict(r) for r in rows]

    def export_csv(self, session_id: int) -> str:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(COLUMNS)
        for s in self.samples(session_id):
            w.writerow([s[c] for c in COLUMNS])
        return buf.getvalue()
