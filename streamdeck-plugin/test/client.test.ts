import { beforeEach, describe, expect, it } from "vitest";
import { BackendClient, normaliseUrl, type BackendState, type ClientDeps, type WebSocketLike } from "../src/client";

class FakeSocket implements WebSocketLike {
	onopen: ((ev: unknown) => void) | null = null;
	onmessage: ((ev: { data: unknown }) => void) | null = null;
	onclose: ((ev: unknown) => void) | null = null;
	onerror: ((ev: unknown) => void) | null = null;
	closed = false;
	constructor(public url: string) {}
	close() { this.closed = true; }
	send(state: Partial<BackendState>) { this.onmessage?.({ data: JSON.stringify({ ...BASE, ...state }) }); }
}

const BASE: BackendState = {
	connected: true, state: "running", status: "", target_kmh: 2, cap: 3, speed_min: 1, speed_step: 0.1,
	incline_supported: true, incline_max: 9, session_id: 1, live: { speed_kmh: 2 }, avg_speed_kmh: null,
};

let t = 0;
let sockets: FakeSocket[] = [];
let timers: { fn: () => void; at: number }[] = [];
let calls: { url: string; body?: string }[] = [];
let httpStatus = 200;

const deps = (): ClientDeps => ({
	fetch: (async (url: string, init?: RequestInit) => {
		calls.push({ url, body: init?.body as string });
		return { ok: httpStatus === 200, status: httpStatus, json: async () => (httpStatus === 200 ? {} : { detail: "start the belt first" }) };
	}) as unknown as typeof fetch,
	createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
	now: () => t,
	setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; },
	clearTimeout: (h) => { timers = timers.filter((x) => x !== h); },
	setInterval: () => ({}),
	clearInterval: () => {},
});

const fire = () => { const due = timers.filter((x) => x.at <= t); timers = timers.filter((x) => !due.includes(x)); due.forEach((x) => x.fn()); };

let c: BackendClient;
beforeEach(() => {
	t = 1000; sockets = []; timers = []; calls = []; httpStatus = 200;
	c = new BackendClient({ url: "localhost:8000", minCommandGapMs: 150 }, deps());
	c.start();
});

describe("connection", () => {
	it("connects to the ws endpoint and exposes state", () => {
		expect(sockets[0].url).toBe("ws://localhost:8000/ws");
		expect(c.online).toBe(false);
		sockets[0].send({});
		expect(c.state?.state).toBe("running");
	});
	it("is offline when the treadmill is disconnected, even if the backend is up", () => {
		sockets[0].send({ connected: false, state: "offline" });
		expect(c.state).toBeNull();
	});
	it("treats old data as offline (never stale)", () => {
		sockets[0].send({});
		t += 11_000;
		expect(c.state).toBeNull();
	});
	it("reconnects with growing backoff and drops state on close", () => {
		sockets[0].send({});
		sockets[0].onclose?.({});
		expect(c.state).toBeNull();
		t += 999; fire(); expect(sockets.length).toBe(1);
		t += 1; fire(); expect(sockets.length).toBe(2);
		sockets[1].onclose?.({});
		t += 1999; fire(); expect(sockets.length).toBe(2);
		t += 1; fire(); expect(sockets.length).toBe(3);
	});
	it("normalises urls", () => {
		expect(normaliseUrl("localhost:9000/")).toBe("http://localhost:9000");
		expect(normaliseUrl("")).toBe("http://localhost:8000");
	});
});

describe("commands", () => {
	beforeEach(() => sockets[0].send({}));

	it("does not send non-stop commands while offline and never queues them", async () => {
		sockets[0].onclose?.({});
		const r = await c.pause();
		expect(r).toEqual({ ok: false, error: "offline" });
		sockets[0] = sockets[0]; // reconnect: nothing may be replayed
		t += 1000; fire(); sockets[1].send({});
		expect(calls.length).toBe(0);
	});
	it("always attempts stop, even offline, bypassing the rate limiter", async () => {
		await c.pause();
		sockets[0].onclose?.({});
		const r = await c.stop();
		expect(r.ok).toBe(true);
		expect(calls.map((x) => x.url.split("/api/")[1])).toEqual(["pause", "stop"]);
	});
	it("rate limits rapid commands by dropping, not queueing", async () => {
		expect((await c.setSpeed(2.5)).ok).toBe(true);
		t += 50;
		expect(await c.setSpeed(3)).toEqual({ ok: false, error: "rate limited" });
		t += 200;
		expect((await c.setSpeed(3)).ok).toBe(true);
		expect(calls.length).toBe(2);
	});
	it("surfaces backend rejections", async () => {
		httpStatus = 409;
		expect(await c.pause()).toEqual({ ok: false, error: "start the belt first" });
	});
	it("remembers the requested speed briefly for rapid steps", async () => {
		await c.setSpeed(2.5);
		expect(c.requestedSpeed).toBe(2.5);
		t += 6000;
		expect(c.requestedSpeed).toBeNull();
	});
	it("start sends the confirmed flag", async () => {
		await c.startBelt();
		expect(JSON.parse(calls[0].body!)).toEqual({ confirmed: true });
	});
});
