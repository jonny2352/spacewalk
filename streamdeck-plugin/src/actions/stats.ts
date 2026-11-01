import type { JsonObject } from "@elgato/utils";
import { action, type DialDownEvent, type DialRotateEvent } from "@elgato/streamdeck";

import type { BackendState } from "../client";
import { engine, type RenderContext } from "../engine";
import { clampSpeed, formatDistance, formatKcal, formatSpeed, formatTime } from "../format";
import type { KeyImage, Tone } from "../image";
import { PadAction, type Surface } from "./base";
import { baseSpeed } from "./controls";

const P = "com.jonny2352.walkingpad";

const toneOf = (st: BackendState): Tone => (st.state === "running" ? "running" : st.state === "paused" ? "paused" : "idle");

type StatSettings = { metric?: string } & JsonObject;

/** One configurable live metric. */
@action({ UUID: `${P}.stat` })
export class StatAction extends PadAction<StatSettings> {
	protected view(s: StatSettings, ctx: RenderContext): KeyImage {
		const metric = s.metric ?? "speed";
		const st = ctx.state;
		if (metric === "connection") {
			return st
				? { tone: toneOf(st), label: "PAD", value: st.state.toUpperCase() }
				: { tone: "offline", label: "PAD", value: "OFFLINE" };
		}
		if (!st) return { tone: "offline", label: label(metric), value: "offline", dim: true };
		const live = st.live;
		const tone = toneOf(st);
		switch (metric) {
			case "distance": {
				const d = formatDistance(live.distance_m);
				return { tone, label: "DISTANCE", value: d.value, unit: d.unit };
			}
			case "time":
				return { tone, label: "TIME", value: formatTime(live.elapsed_s) };
			case "calories":
				return { tone, label: "CALORIES", value: formatKcal(live.energy_kcal), unit: "kcal" };
			case "steps":
				return { tone, label: "STEPS", value: live.steps == null ? "N/A" : String(live.steps) };
			case "avg_speed":
				return { tone, label: "AVG SPEED", value: formatSpeed(st.avg_speed_kmh), unit: "km/h" };
			default:
				return { tone, label: "SPEED", value: formatSpeed(live.speed_kmh), unit: "km/h" };
		}
	}
}

function label(metric: string): string {
	return { distance: "DISTANCE", time: "TIME", calories: "CALORIES", steps: "STEPS", avg_speed: "AVG SPEED" }[metric] ?? "SPEED";
}

/** Today's totals over all stored sessions: distance, time and calories on one key. */
@action({ UUID: `${P}.today` })
export class TodayAction extends PadAction {
	protected view(_s: JsonObject, ctx: RenderContext): KeyImage {
		const t = ctx.today;
		if (!ctx.state && !t) return { tone: "offline", label: "TODAY", value: "offline", dim: true };
		const d = formatDistance(t?.distance_m);
		return { tone: ctx.state ? "idle" : "offline", label: "TODAY", value: `${d.value} ${d.unit}`, unit: `${formatTime(t?.seconds)} · ${formatKcal(t?.kcal)} kcal`.replace("·", "|"), dim: !ctx.state };
	}
}

// ---------------------------------------------------------------------------
type DialSettings = { step?: number } & JsonObject;

/** Stream Deck +: rotate = speed within the cap, press = stop, touch strip shows speed/time/distance. */
@action({ UUID: `${P}.dial` })
export class DialAction extends PadAction<DialSettings> {
	protected view(_s: DialSettings, ctx: RenderContext): KeyImage {
		const st = ctx.state;
		if (!st) return { tone: "offline", label: "SPEED", value: "offline", dim: true };
		return { tone: toneOf(st), label: "SPEED", value: formatSpeed(st.live.speed_kmh), unit: "km/h" };
	}

	protected override afterRender(_id: string, action: Surface<DialSettings>, ctx: RenderContext): void {
		if (!action.isDial()) return;
		const st = ctx.state;
		const d = formatDistance(st?.live.distance_m);
		void action.setFeedback({
			speed: st ? `${formatSpeed(st.live.speed_kmh)} km/h` : "offline",
			time: st ? formatTime(st.live.elapsed_s) : "",
			distance: st ? `${d.value} ${d.unit}` : "",
		});
	}

	override async onDialRotate(ev: DialRotateEvent<DialSettings>): Promise<void> {
		const st = engine.client.state;
		if (!st || st.state !== "running") return void ev.action.showAlert();
		const step = Math.max(0.1, Number(ev.payload.settings.step ?? 0.1));
		const target = clampSpeed(baseSpeed(engine.client, st) + ev.payload.ticks * step, st.speed_min, st.cap);
		await this.run(ev.action, `dial speed ${target}`, engine.client.setSpeed(target));
	}

	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		await this.run(ev.action, "dial stop", engine.client.stop());
	}
}
