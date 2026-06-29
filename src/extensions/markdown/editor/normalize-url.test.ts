import { describe, expect, test } from "vitest";
import { normalizeUrl } from "./normalize-url";

describe("normalizeUrl", () => {
	test("prefixes https:// onto bare domains", () => {
		expect(normalizeUrl("superset.sh")).toBe("https://superset.sh");
		expect(normalizeUrl("example.com/path?q=1")).toBe(
			"https://example.com/path?q=1",
		);
	});

	test("leaves fully-qualified URLs untouched", () => {
		expect(normalizeUrl("https://example.com")).toBe("https://example.com");
		expect(normalizeUrl("http://example.com")).toBe("http://example.com");
		expect(normalizeUrl("ftp://files.example.com")).toBe(
			"ftp://files.example.com",
		);
	});

	test("passes through schemes without an authority", () => {
		expect(normalizeUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
		expect(normalizeUrl("tel:+15551234")).toBe("tel:+15551234");
	});

	test("turns bare emails into mailto: links", () => {
		expect(normalizeUrl("hi@example.com")).toBe("mailto:hi@example.com");
	});

	test("keeps anchors and relative paths", () => {
		expect(normalizeUrl("#section")).toBe("#section");
		expect(normalizeUrl("/docs/intro")).toBe("/docs/intro");
		expect(normalizeUrl("./intro.md")).toBe("./intro.md");
		expect(normalizeUrl("../page")).toBe("../page");
	});

	test("trims surrounding whitespace", () => {
		expect(normalizeUrl("  example.com  ")).toBe("https://example.com");
	});

	test("returns null for empty input", () => {
		expect(normalizeUrl("")).toBeNull();
		expect(normalizeUrl("   ")).toBeNull();
	});

	test("does not mistake a host:port for a scheme", () => {
		expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
	});
});
