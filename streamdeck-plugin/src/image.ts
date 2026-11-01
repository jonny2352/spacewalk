/** Dynamic key images as SVG data URIs. Drawn at 144x144; Stream Deck scales to 72x72 keys. */

export type Tone = "running" | "paused" | "idle" | "offline" | "stop" | "armed";
export type Glyph = "play" | "pause" | "stop" | "plus" | "minus" | "incline-up" | "incline-down";

const COLORS: Record<Tone, string> = {
	running: "#14804f",
	paused: "#b8790c",
	idle: "#3c434d",
	offline: "#4a2626",
	stop: "#d02a1f",
	armed: "#e0a000",
};

export interface KeyImage {
	tone: Tone;
	/** Small caption at the top. */
	label?: string;
	/** Big value in the middle. */
	value?: string;
	/** Small unit under the value. */
	unit?: string;
	/** Optional big glyph instead of a value. */
	glyph?: Glyph;
	/** Dim the content (key present but not usable right now). */
	dim?: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function valueSize(text: string): number {
	const n = text.length;
	return n <= 3 ? 64 : n === 4 ? 54 : n === 5 ? 44 : n === 6 ? 38 : 32;
}

function glyphPath(g: Glyph): string {
	const w = 'fill="#fff"';
	switch (g) {
		case "play":
			return `<path ${w} d="M56 36 L56 100 L102 68 Z"/>`;
		case "pause":
			return `<rect ${w} x="48" y="36" width="16" height="64" rx="3"/><rect ${w} x="78" y="36" width="16" height="64" rx="3"/>`;
		case "stop":
			return `<rect ${w} x="42" y="38" width="60" height="60" rx="6"/>`;
		case "plus":
			return `<rect ${w} x="62" y="36" width="20" height="64" rx="3"/><rect ${w} x="40" y="58" width="64" height="20" rx="3"/>`;
		case "minus":
			return `<rect ${w} x="40" y="58" width="64" height="20" rx="3"/>`;
		case "incline-up":
			return `<path ${w} d="M30 98 L114 98 L114 44 Z"/>`;
		case "incline-down":
			return `<path ${w} d="M30 44 L114 44 L114 98 Z"/>`;
	}
}

export function keySvg(img: KeyImage): string {
	const bg = COLORS[img.tone];
	const op = img.dim ? 0.45 : 1;
	let body = "";
	if (img.glyph) {
		body += `<g opacity="${op}">${glyphPath(img.glyph)}</g>`;
		if (img.value) {
			body += `<text x="72" y="130" text-anchor="middle" font-size="28" font-weight="700" fill="#fff" opacity="${op}">${esc(img.value)}</text>`;
		}
	} else if (img.value !== undefined) {
		const size = valueSize(img.value);
		body += `<text x="72" y="${img.unit ? 86 : 92}" text-anchor="middle" font-size="${size}" font-weight="700" fill="#fff" opacity="${op}">${esc(img.value)}</text>`;
		if (img.unit) {
			body += `<text x="72" y="118" text-anchor="middle" font-size="26" fill="#fff" opacity="${0.8 * op}">${esc(img.unit)}</text>`;
		}
	}
	if (img.label) {
		body += `<text x="72" y="30" text-anchor="middle" font-size="22" font-weight="600" fill="#fff" opacity="${0.85 * op}">${esc(img.label)}</text>`;
	}
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144" font-family="Segoe UI, Helvetica, Arial, sans-serif">` +
		`<rect width="144" height="144" rx="14" fill="${bg}"/>${body}</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}
