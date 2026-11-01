import { describe, expect, it } from "vitest";
import { clampSpeed, formatDistance, formatKcal, formatSpeed, formatTime } from "../src/format";

describe("format", () => {
	it("formats speed to one decimal, dash when missing", () => {
		expect(formatSpeed(2)).toBe("2.0");
		expect(formatSpeed(2.46)).toBe("2.5");
		expect(formatSpeed(undefined)).toBe("–");
	});
	it("formats distance in m below 1 km and km above", () => {
		expect(formatDistance(850)).toEqual({ value: "850", unit: "m" });
		expect(formatDistance(1250)).toEqual({ value: "1.25", unit: "km" });
		expect(formatDistance(null)).toEqual({ value: "–", unit: "km" });
	});
	it("formats time as m:ss and h:mm:ss", () => {
		expect(formatTime(0)).toBe("0:00");
		expect(formatTime(74)).toBe("1:14");
		expect(formatTime(3599)).toBe("59:59");
		expect(formatTime(3725)).toBe("1:02:05");
		expect(formatTime(undefined)).toBe("–");
	});
	it("formats calories", () => {
		expect(formatKcal(12.6)).toBe("13");
		expect(formatKcal(undefined)).toBe("–");
	});
	it("clamps speed to range and 0.1 resolution", () => {
		expect(clampSpeed(9, 1, 3)).toBe(3);
		expect(clampSpeed(0.2, 1, 3)).toBe(1);
		expect(clampSpeed(2.04, 1, 6)).toBe(2);
	});
});
