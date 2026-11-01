// Generates all static image assets. Run: npm run icons
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = "com.jonny2352.walkingpad.sdPlugin";
const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };

// Action list icons: 20x20 monochrome white SVG.
const glyphs = {
	start: '<path fill="#fff" d="M6 3v14l11-7z"/>',
	stop: '<rect fill="#fff" x="4" y="4" width="12" height="12" rx="1.5"/>',
	pause: '<rect fill="#fff" x="5" y="3" width="3.5" height="14" rx=".8"/><rect fill="#fff" x="11.5" y="3" width="3.5" height="14" rx=".8"/>',
	"speed-up": '<path fill="#fff" d="M8.5 3h3v5.5H17v3h-5.5V17h-3v-5.5H3v-3h5.5z"/>',
	"speed-down": '<rect fill="#fff" x="3" y="8.5" width="14" height="3" rx=".8"/>',
	preset: '<path fill="#fff" d="M10 3a8 8 0 0 0-8 8h2a6 6 0 0 1 12 0h2a8 8 0 0 0-8-8zm.9 4.3L8.5 12a1.5 1.5 0 1 0 2.2 1.2l1.2-5.4z"/>',
	"incline-up": '<path fill="#fff" d="M2 16h16V5z"/>',
	"incline-down": '<path fill="#fff" d="M2 5h16v11z"/>',
	stat: '<path fill="#fff" d="M3 16V9h3v7zm5.5 0V4h3v12zM14 16v-5h3v5z"/>',
	today: '<path fill="#fff" d="M4 3h2v2h8V3h2v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1zm-1 5v8h14V8z"/>',
	dial: '<circle cx="10" cy="10" r="7" fill="none" stroke="#fff" stroke-width="2"/><path fill="#fff" d="M9 3h2v5H9z"/>',
};
for (const [name, g] of Object.entries(glyphs)) {
	w(`imgs/actions/${name}/icon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${g}</svg>`);
	// Default key image (replaced by the plugin at runtime): dark tile with the glyph.
	w(`imgs/actions/${name}/key.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect width="72" height="72" rx="8" fill="#3c434d"/><g transform="translate(16 16) scale(2)">${g}</g></svg>`);
}
w("imgs/plugin/category-icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle fill="#fff" cx="15" cy="5" r="3"/><path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M14 10l-3 6 4 3 1 6M14 10l4 3 3-1M11 16l-4 2"/><rect fill="#fff" x="3" y="25" width="22" height="2.2" rx="1"/></svg>`);

// Plugin icon PNG (256 and 512): green rounded tile with a white walking figure.
function png(size) {
	const px = Buffer.alloc(size * size * 4);
	const s = size / 256;
	const inRound = (x, y, r) => { const d = Math.min(x, size - 1 - x, y, size - 1 - y); if (d >= r) return true; const cx = Math.min(Math.max(x, r), size - 1 - r), cy = Math.min(Math.max(y, r), size - 1 - r); return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };
	const seg = (x, y, ax, ay, bx, by, t) => { const dx = bx - ax, dy = by - ay; const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return (x - ax - u * dx) ** 2 + (y - ay - u * dy) ** 2 <= t * t; };
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const o = (y * size + x) * 4, X = x / s, Y = y / s;
		if (!inRound(x, y, 40 * s)) continue;
		let c = [20, 128, 79];
		const white = ((X - 138) ** 2 + (Y - 58) ** 2 <= 17 ** 2) ||
			seg(X, Y, 128, 90, 108, 140, 9) || seg(X, Y, 108, 140, 140, 165, 9) || seg(X, Y, 140, 165, 148, 205, 9) ||
			seg(X, Y, 128, 90, 160, 112, 9) || seg(X, Y, 160, 112, 178, 100, 8) || seg(X, Y, 108, 140, 84, 152, 8) ||
			seg(X, Y, 128, 90, 140, 118, 12) || (Y > 212 && Y < 224 && X > 50 && X < 206);
		if (white) c = [255, 255, 255];
		px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
	}
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
	const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
	const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
	const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
w("imgs/plugin/marketplace.png", png(256));
w("imgs/plugin/marketplace@2x.png", png(512));
console.log("icons written");
