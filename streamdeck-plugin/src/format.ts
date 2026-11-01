/** Pure formatting helpers for key text. Missing values render as an en dash. */
const DASH = "–";

export function formatSpeed(kmh: number | null | undefined): string {
	return kmh == null || Number.isNaN(kmh) ? DASH : kmh.toFixed(1);
}

/** Metres below 1 km, else km with two decimals ("850 m", "1.25 km"). */
export function formatDistance(metres: number | null | undefined): { value: string; unit: string } {
	if (metres == null || Number.isNaN(metres)) return { value: DASH, unit: "km" };
	if (metres < 1000) return { value: String(Math.round(metres)), unit: "m" };
	return { value: (metres / 1000).toFixed(2), unit: "km" };
}

/** m:ss under an hour, h:mm:ss from an hour. */
export function formatTime(seconds: number | null | undefined): string {
	if (seconds == null || Number.isNaN(seconds)) return DASH;
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatKcal(kcal: number | null | undefined): string {
	return kcal == null || Number.isNaN(kcal) ? DASH : String(Math.round(kcal));
}

/** Round to the pad's 0.1 km/h resolution and keep inside [min, max]. */
export function clampSpeed(kmh: number, min: number, max: number): number {
	return Math.round(Math.min(max, Math.max(min, kmh)) * 10) / 10;
}
