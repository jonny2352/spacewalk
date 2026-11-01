import type { JsonObject } from "@elgato/utils";
import streamDeck, { action, type KeyDownEvent } from "@elgato/streamdeck";

import type { BackendClient, BackendState } from "../client";
import { engine, type RenderContext } from "../engine";
import { clampSpeed, formatSpeed } from "../format";
import type { KeyImage } from "../image";
import { PadAction } from "./base";

const P = "com.jonny2352.walkingpad";
const ARM_MS = 3000;

/** Speed the belt is heading to (or at): the last request, else the backend target, else the measured speed. */
export function baseSpeed(client: BackendClient, s: BackendState): number {
	return client.requestedSpeed ?? (s.target_kmh > 0 ? s.target_kmh : (s.live.speed_kmh ?? s.speed_min));
}

const offline = (label: string): KeyImage => ({ tone: "offline", label, value: "offline", dim: true });

// ---------------------------------------------------------------------------
type StartSettings = { arm?: boolean } & JsonObject;

/** Start / Resume. First press arms the key (3 s), the second starts the belt. */
@action({ UUID: `${P}.start` })
export class StartAction extends PadAction<StartSettings> {
	private armed = new Map<string, number>();
	private flash: ReturnType<typeof setInterval> | null = null;

	protected view(_s: StartSettings, ctx: RenderContext, id: string): KeyImage {
		const st = ctx.state;
		if (!st) {
			this.armed.delete(id); // never carry an armed key across an outage
			return offline("START");
		}
		const expiry = this.armed.get(id);
		if (expiry && ctx.now < expiry) {
			const on = Math.floor(ctx.now / 400) % 2 === 0;
			return { tone: on ? "armed" : "idle", label: "PRESS AGAIN", value: "START", unit: "to confirm" };
		}
		this.armed.delete(id);
		if (st.state === "running") return { tone: "running", label: "RUNNING", glyph: "play", value: `${formatSpeed(st.live.speed_kmh)} km/h` };
		if (st.state === "paused") return { tone: "paused", label: "PAUSED", glyph: "play", value: "RESUME" };
		return { tone: "idle", label: "IDLE", glyph: "play", value: "START" };
	}

	override async onKeyDown(ev: KeyDownEvent<StartSettings>): Promise<void> {
		const st = engine.client.state;
		if (!st) return void ev.action.showAlert();
		if (st.state === "running") return; // nothing to start
		const needArm = ev.payload.settings.arm !== false;
		const id = ev.action.id;
		const expiry = this.armed.get(id);
		if (needArm && !(expiry && Date.now() < expiry)) {
			this.armed.set(id, Date.now() + ARM_MS);
			this.startFlash();
			engine.refresh(true);
			return;
		}
		this.armed.delete(id);
		await this.run(ev.action, "start", engine.client.startBelt());
	}

	private startFlash(): void {
		if (this.flash) return;
		this.flash = setInterval(() => {
			const now = Date.now();
			if (![...this.armed.values()].some((t) => t > now)) {
				clearInterval(this.flash!);
				this.flash = null;
			}
			engine.refresh(true);
		}, 400);
	}

	protected override disappeared(id: string): void {
		this.armed.delete(id);
	}
}

// ---------------------------------------------------------------------------
/** Emergency stop: no confirmation, works even when other keys are disabled. */
@action({ UUID: `${P}.stop` })
export class StopAction extends PadAction {
	protected view(_s: JsonObject, ctx: RenderContext): KeyImage {
		return { tone: "stop", label: "STOP", glyph: "stop", dim: false, value: ctx.state ? undefined : "no link" };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.run(ev.action, "stop", engine.client.stop());
	}
}

// ---------------------------------------------------------------------------
@action({ UUID: `${P}.pause` })
export class PauseAction extends PadAction {
	protected view(_s: JsonObject, ctx: RenderContext): KeyImage {
		const st = ctx.state;
		if (!st) return offline("PAUSE");
		if (st.state === "paused") return { tone: "paused", label: "PAUSED", glyph: "pause" };
		return { tone: st.state === "running" ? "idle" : "idle", label: "PAUSE", glyph: "pause", dim: st.state !== "running" };
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const st = engine.client.state;
		if (!st || st.state !== "running") return void ev.action.showAlert();
		await this.run(ev.action, "pause", engine.client.pause());
	}
}

// ---------------------------------------------------------------------------
type StepSettings = { step?: number } & JsonObject;

abstract class SpeedStep extends PadAction<StepSettings> {
	protected abstract readonly sign: 1 | -1;

	protected view(s: StepSettings, ctx: RenderContext): KeyImage {
		const st = ctx.state;
		if (!st) return offline(this.sign > 0 ? "FASTER" : "SLOWER");
		const running = st.state === "running";
		return {
			tone: running ? "running" : "idle",
			label: `${this.sign > 0 ? "+" : "−"}${s.step ?? 0.5}`,
			glyph: this.sign > 0 ? "plus" : "minus",
			value: running ? `${formatSpeed(baseSpeed(ctx.client, st))} km/h` : undefined,
			dim: !running,
		};
	}

	override async onKeyDown(ev: KeyDownEvent<StepSettings>): Promise<void> {
		const st = engine.client.state;
		if (!st || st.state !== "running") return void ev.action.showAlert();
		const step = Math.max(0.1, Number(ev.payload.settings.step ?? 0.5));
		const target = clampSpeed(baseSpeed(engine.client, st) + this.sign * step, st.speed_min, st.cap);
		await this.run(ev.action, `speed ${target}`, engine.client.setSpeed(target));
	}
}

@action({ UUID: `${P}.speed-up` })
export class SpeedUpAction extends SpeedStep {
	protected readonly sign = 1;
}

@action({ UUID: `${P}.speed-down` })
export class SpeedDownAction extends SpeedStep {
	protected readonly sign = -1;
}

// ---------------------------------------------------------------------------
type PresetSettings = { speed?: number } & JsonObject;

/** Jump to a fixed speed. The backend applies the cap and ramps in small steps. */
@action({ UUID: `${P}.preset` })
export class PresetAction extends PadAction<PresetSettings> {
	protected view(s: PresetSettings, ctx: RenderContext): KeyImage {
		const speed = Number(s.speed ?? 2);
		const st = ctx.state;
		if (!st) return offline("PRESET");
		const running = st.state === "running";
		const current = running && Math.abs(baseSpeed(ctx.client, st) - clampSpeed(speed, st.speed_min, st.cap)) < 0.05;
		return { tone: current ? "running" : "idle", label: "SET SPEED", value: formatSpeed(speed), unit: "km/h", dim: !running };
	}

	override async onKeyDown(ev: KeyDownEvent<PresetSettings>): Promise<void> {
		const st = engine.client.state;
		if (!st || st.state !== "running") return void ev.action.showAlert();
		const target = clampSpeed(Number(ev.payload.settings.speed ?? 2), st.speed_min, st.cap);
		await this.run(ev.action, `preset ${target}`, engine.client.setSpeed(target));
	}
}

// ---------------------------------------------------------------------------
abstract class InclineStep extends PadAction<StepSettings> {
	protected abstract readonly sign: 1 | -1;

	protected view(s: StepSettings, ctx: RenderContext): KeyImage {
		const st = ctx.state;
		if (!st) return offline("INCLINE");
		if (!st.incline_supported) return { tone: "idle", label: "INCLINE", value: "N/A", dim: true };
		return {
			tone: "idle",
			label: `${this.sign > 0 ? "+" : "−"}${s.step ?? 1}%`,
			glyph: this.sign > 0 ? "incline-up" : "incline-down",
			value: `${(st.live.incline_pct ?? 0).toFixed(0)}%`,
		};
	}

	override async onKeyDown(ev: KeyDownEvent<StepSettings>): Promise<void> {
		const st = engine.client.state;
		if (!st || !st.incline_supported) return void ev.action.showAlert();
		const step = Math.max(0.5, Number(ev.payload.settings.step ?? 1));
		const target = Math.min(st.incline_max, Math.max(0, (st.live.incline_pct ?? 0) + this.sign * step));
		await this.run(ev.action, `incline ${target}`, engine.client.setIncline(target));
	}
}

@action({ UUID: `${P}.incline-up` })
export class InclineUpAction extends InclineStep {
	protected readonly sign = 1;
}

@action({ UUID: `${P}.incline-down` })
export class InclineDownAction extends InclineStep {
	protected readonly sign = -1;
}

streamDeck.logger.debug("controls loaded");
