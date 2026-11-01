/**
 * Shared client for the walking pad backend (web.py). The plugin never talks to the treadmill
 * itself: live state comes over WebSocket, commands go over HTTP.
 *
 * Safety properties:
 *  - Nothing is queued: a command sent while offline fails at once and is never replayed.
 *  - Stop bypasses the offline check and the rate limiter.
 *  - Other commands are rate limited (dropped, not delayed) so rapid presses cannot flood the pad.
 *  - State older than `staleMs` is treated as offline, so keys never show stale data as live.
 */

export interface LiveData {
	speed_kmh?: number;
	distance_m?: number;
	incline_pct?: number;
	energy_kcal?: number;
	heart_rate?: number;
	elapsed_s?: number;
	steps?: number;
}

export interface BackendState {
	connected: boolean;
	state: "offline" | "idle" | "running" | "paused";
	status: string;
	target_kmh: number;
	cap: number;
	speed_min: number;
	speed_step: number;
	incline_supported: boolean;
	incline_max: number;
	session_id: number | null;
	live: LiveData;
	avg_speed_kmh: number | null;
}

export interface Today {
	distance_m: number;
	seconds: number;
	kcal: number;
}

export interface CommandResult {
	ok: boolean;
	error?: string;
}

export interface WebSocketLike {
	onopen: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onclose: ((ev: unknown) => void) | null;
	onerror: ((ev: unknown) => void) | null;
	close(): void;
}

export interface ClientDeps {
	fetch: typeof fetch;
	createSocket: (url: string) => WebSocketLike;
	now: () => number;
	setTimeout: (fn: () => void, ms: number) => unknown;
	clearTimeout: (handle: unknown) => void;
	setInterval: (fn: () => void, ms: number) => unknown;
	clearInterval: (handle: unknown) => void;
}

export interface ClientOptions {
	url?: string;
	staleMs?: number;
	minCommandGapMs?: number;
	pollMs?: number;
	maxBackoffMs?: number;
}

export const DEFAULT_URL = "http://localhost:8000";

const realDeps = (): ClientDeps => ({
	fetch: (...a) => fetch(...a),
	createSocket: (url) => new WebSocket(url) as unknown as WebSocketLike,
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
});

export class BackendClient {
	private deps: ClientDeps;
	private baseUrl: string;
	private staleMs: number;
	private minGap: number;
	private pollMs: number;
	private maxBackoff: number;
	private socket: WebSocketLike | null = null;
	private reconnectTimer: unknown = null;
	private pollTimer: unknown = null;
	private backoff = 1000;
	private lastMessageAt = 0;
	private lastCommandAt = 0;
	private latest: BackendState | null = null;
	private listeners = new Set<() => void>();
	private running = false;
	/** Speed we last asked for, so rapid +/- presses build on it while the backend ramps. */
	private desiredSpeed: { kmh: number; at: number } | null = null;

	constructor(opts: ClientOptions = {}, deps: ClientDeps = realDeps()) {
		this.deps = deps;
		this.baseUrl = normaliseUrl(opts.url ?? DEFAULT_URL);
		this.staleMs = opts.staleMs ?? 10_000;
		this.minGap = opts.minCommandGapMs ?? 150;
		this.pollMs = opts.pollMs ?? 5_000;
		this.maxBackoff = opts.maxBackoffMs ?? 15_000;
	}

	get url(): string {
		return this.baseUrl;
	}

	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/** The latest backend state, or null when the backend is unreachable, stale, or the pad is disconnected. */
	get state(): BackendState | null {
		const s = this.latest;
		if (!s || !s.connected) return null;
		if (this.deps.now() - this.lastMessageAt > this.staleMs) return null;
		return s;
	}

	get online(): boolean {
		return this.state !== null;
	}

	/** Speed the user most recently requested, if still in flight (within 5 s). */
	get requestedSpeed(): number | null {
		if (!this.desiredSpeed || this.deps.now() - this.desiredSpeed.at > 5000) return null;
		return this.desiredSpeed.kmh;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.connect();
		this.pollTimer = this.deps.setInterval(() => void this.poll(), this.pollMs);
	}

	stopClient(): void {
		this.running = false;
		this.deps.clearInterval(this.pollTimer);
		this.deps.clearTimeout(this.reconnectTimer);
		this.closeSocket();
		this.latest = null;
		this.emit();
	}

	setUrl(url: string): void {
		const next = normaliseUrl(url || DEFAULT_URL);
		if (next === this.baseUrl) return;
		this.baseUrl = next;
		this.latest = null;
		this.backoff = 1000;
		this.emit();
		if (this.running) {
			this.closeSocket();
			this.deps.clearTimeout(this.reconnectTimer);
			this.connect();
		}
	}

	// -- connection ---------------------------------------------------------
	private connect(): void {
		if (!this.running) return;
		const ws = this.deps.createSocket(this.baseUrl.replace(/^http/, "ws") + "/ws");
		this.socket = ws;
		ws.onopen = () => {
			this.backoff = 1000;
		};
		ws.onmessage = (ev) => this.accept(ev.data);
		ws.onerror = () => {
			/* onclose follows */
		};
		ws.onclose = () => {
			if (this.socket !== ws) return;
			this.socket = null;
			this.latest = null; // a dropped link means the last state can no longer be trusted
			this.emit();
			this.scheduleReconnect();
		};
	}

	private closeSocket(): void {
		const ws = this.socket;
		this.socket = null;
		if (ws) {
			ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
			try {
				ws.close();
			} catch {
				/* already closed */
			}
		}
	}

	private scheduleReconnect(): void {
		if (!this.running) return;
		this.deps.clearTimeout(this.reconnectTimer);
		this.reconnectTimer = this.deps.setTimeout(() => this.connect(), this.backoff);
		this.backoff = Math.min(this.backoff * 2, this.maxBackoff);
	}

	private accept(data: unknown): void {
		try {
			const parsed = JSON.parse(String(data)) as BackendState;
			if (typeof parsed !== "object" || parsed === null || !("connected" in parsed)) return;
			this.latest = parsed;
			this.lastMessageAt = this.deps.now();
			this.emit();
		} catch {
			/* ignore malformed frames */
		}
	}

	/** Fallback liveness check; also refreshes state if the socket is quiet. */
	async poll(): Promise<void> {
		try {
			const r = await this.deps.fetch(this.baseUrl + "/api/state");
			if (r.ok) this.accept(JSON.stringify(await r.json()));
		} catch {
			/* socket close handles offline */
		}
		this.emit(); // lets staleness be re-evaluated
	}

	async today(): Promise<Today | null> {
		try {
			const r = await this.deps.fetch(this.baseUrl + "/api/today");
			return r.ok ? ((await r.json()) as Today) : null;
		} catch {
			return null;
		}
	}

	private emit(): void {
		for (const fn of [...this.listeners]) fn();
	}

	// -- commands -----------------------------------------------------------
	private async command(path: string, body: unknown, urgent = false): Promise<CommandResult> {
		const now = this.deps.now();
		if (!urgent) {
			if (!this.online) return { ok: false, error: "offline" };
			if (now - this.lastCommandAt < this.minGap) return { ok: false, error: "rate limited" };
			this.lastCommandAt = now;
		}
		try {
			const r = await this.deps.fetch(this.baseUrl + path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body ?? {}),
			});
			if (r.ok) return { ok: true };
			let detail = `HTTP ${r.status}`;
			try {
				detail = ((await r.json()) as { detail?: string }).detail ?? detail;
			} catch {
				/* keep status text */
			}
			return { ok: false, error: detail };
		} catch (e) {
			return { ok: false, error: `backend unreachable: ${(e as Error).message}` };
		}
	}

	/** Start/resume. The caller is responsible for its own arm-to-confirm step before calling this. */
	startBelt(): Promise<CommandResult> {
		return this.command("/api/start", { confirmed: true });
	}

	/** Emergency stop: always attempted, even when the client believes it is offline. */
	stop(): Promise<CommandResult> {
		this.desiredSpeed = null;
		return this.command("/api/stop", {}, true);
	}

	pause(): Promise<CommandResult> {
		this.desiredSpeed = null;
		return this.command("/api/pause", {});
	}

	async setSpeed(kmh: number): Promise<CommandResult> {
		const res = await this.command("/api/speed", { kmh });
		if (res.ok) this.desiredSpeed = { kmh, at: this.deps.now() };
		return res;
	}

	setIncline(pct: number): Promise<CommandResult> {
		return this.command("/api/incline", { pct });
	}
}

export function normaliseUrl(url: string): string {
	let u = url.trim() || DEFAULT_URL;
	if (!/^https?:\/\//i.test(u)) u = "http://" + u;
	return u.replace(/\/+$/, "");
}
