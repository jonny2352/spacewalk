// Mock of the Spacewalk backend for developing the plugin without the treadmill.
// Run: npm run mock [port]   (default 8000; stop the real backend first or pick another port)
// Extra endpoints: POST /mock/offline, POST /mock/online to simulate a treadmill disconnect.
import http from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 8000);
const CAP = 6, MIN = 1;
let connected = true, state = "idle", target = 0, speed = 0, distance = 0, elapsed = 0, kcal = 0, incline = 0;

const snapshot = () => ({
	connected, state: !connected ? "offline" : speed > 0 ? "running" : state === "paused" ? "paused" : "idle",
	status: "", target_kmh: target, cap: CAP, speed_min: MIN, speed_step: 0.1, incline_supported: true, incline_max: 9,
	session_id: speed > 0 ? 1 : null, avg_speed_kmh: elapsed ? +(distance / elapsed * 3.6).toFixed(2) : null,
	live: connected ? { speed_kmh: +speed.toFixed(1), distance_m: Math.round(distance), incline_pct: incline, energy_kcal: Math.round(kcal), elapsed_s: elapsed } : {},
	server_time: Date.now() / 1000, log: [],
});

const wss = new WebSocketServer({ noServer: true });
const push = () => { const s = JSON.stringify(snapshot()); wss.clients.forEach((c) => c.readyState === 1 && c.send(s)); };

setInterval(() => {
	if (speed < target) speed = Math.min(target, speed + 0.1 * 2);
	else if (speed > target) speed = Math.max(target, speed - 0.2);
	if (speed > 0) { distance += speed / 3.6; elapsed += 1; kcal += speed * 0.02; }
	push();
}, 1000);

const send = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
	let raw = "";
	req.on("data", (d) => (raw += d));
	req.on("end", () => {
		const body = raw ? JSON.parse(raw) : {};
		const url = req.url ?? "";
		console.log(req.method, url, raw);
		if (url === "/api/state") return send(res, 200, snapshot());
		if (url === "/api/today") return send(res, 200, { distance_m: Math.round(distance) + 1800, seconds: elapsed + 1500, kcal: Math.round(kcal) + 60 });
		if (url === "/mock/offline") { connected = false; speed = 0; push(); return send(res, 200, {}); }
		if (url === "/mock/online") { connected = true; return send(res, 200, {}); }
		if (req.method !== "POST") return send(res, 404, {});
		if (!connected) return send(res, 409, { detail: "not connected" });
		if (url === "/api/stop") { target = 0; speed = 0; state = "idle"; push(); return send(res, 200, { ok: true }); }
		if (url === "/api/start") {
			if (!body.confirmed) return send(res, 400, { detail: "start must be confirmed" });
			target = target || MIN; speed = Math.max(speed, MIN); state = "idle"; return send(res, 200, { ok: true });
		}
		if (url === "/api/pause") { target = 0; speed = 0; state = "paused"; return send(res, 200, { ok: true }); }
		if (url === "/api/speed") {
			if (speed <= 0) return send(res, 409, { detail: "start the belt first (needs confirmation)" });
			target = Math.min(CAP, Math.max(MIN, body.kmh)); return send(res, 200, { target });
		}
		if (url === "/api/incline") { incline = Math.min(9, Math.max(0, body.pct)); return send(res, 200, { ok: true }); }
		send(res, 404, {});
	});
});
server.on("upgrade", (req, sock, head) => req.url === "/ws" ? wss.handleUpgrade(req, sock, head, (ws) => { ws.send(JSON.stringify(snapshot())); }) : sock.destroy());
server.listen(port, "127.0.0.1", () => console.log(`mock backend on http://127.0.0.1:${port}`));
