import type { JsonObject } from "@elgato/utils";
import streamDeck from "@elgato/streamdeck";

import { BackendClient, DEFAULT_URL, type BackendState, type Today } from "./client";

/** Everything an action needs to draw itself. `state` is null whenever the pad/backend is offline or stale. */
export interface RenderContext {
	client: BackendClient;
	state: BackendState | null;
	today: Today | null;
	now: number;
}

export interface Refreshable {
	refresh(ctx: RenderContext): void;
}

const MIN_REFRESH_MS = 1000;
const TODAY_REFRESH_MS = 15_000;

/**
 * Owns the single backend client and re-renders every visible key. Passive refreshes are throttled
 * to once per second; presses and online/offline transitions force an immediate refresh.
 */
class Engine {
	readonly client = new BackendClient();
	private actions = new Set<Refreshable>();
	private today: Today | null = null;
	private lastRefresh = 0;
	private lastOnline = false;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private todayTimer: ReturnType<typeof setInterval> | null = null;

	register(a: Refreshable): void {
		this.actions.add(a);
	}

	async init(): Promise<void> {
		const apply = (s: JsonObject) => {
			const url = typeof s.backendUrl === "string" && s.backendUrl ? s.backendUrl : DEFAULT_URL;
			this.client.setUrl(url);
		};
		streamDeck.settings.onDidReceiveGlobalSettings((ev) => apply(ev.settings));
		apply(await streamDeck.settings.getGlobalSettings());

		this.client.onChange(() => {
			const online = this.client.online;
			if (online !== this.lastOnline) {
				this.lastOnline = online;
				if (online) void this.loadToday();
				this.refresh(true);
			} else {
				this.refresh(false);
			}
		});
		this.client.start();
		this.todayTimer = setInterval(() => void this.loadToday(), TODAY_REFRESH_MS);
		void this.loadToday();
	}

	async loadToday(): Promise<void> {
		this.today = await this.client.today();
		this.refresh(false);
	}

	/** Redraw all visible keys. `force` skips the once-per-second throttle. */
	refresh(force: boolean): void {
		const now = Date.now();
		const wait = this.lastRefresh + MIN_REFRESH_MS - now;
		if (!force && wait > 0) {
			if (!this.timer) {
				this.timer = setTimeout(() => {
					this.timer = null;
					this.refresh(true);
				}, wait);
			}
			return;
		}
		this.lastRefresh = now;
		const ctx: RenderContext = { client: this.client, state: this.client.state, today: this.today, now };
		for (const a of this.actions) a.refresh(ctx);
	}
}

export const engine = new Engine();
