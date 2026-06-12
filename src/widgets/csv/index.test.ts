import { describe, expect, test } from "vitest";
import { parseCsv } from "./index";

describe("parseCsv", () => {
	test("parses simple CSV with headers", () => {
		const parsed = parseCsv("name,value\nalpha,1\nbeta,2");

		expect(parsed.columns).toEqual(["name", "value"]);
		expect(parsed.rows).toEqual([
			{ rowNumber: 1, cells: ["alpha", "1"] },
			{ rowNumber: 2, cells: ["beta", "2"] },
		]);
	});

	test("uses Papa Parse semantics for quoted commas and newlines", () => {
		const parsed = parseCsv('name,notes\nalpha,"hello, world"\nbeta,"line 1\nline 2"');

		expect(parsed.rows[0]?.cells).toEqual(["alpha", "hello, world"]);
		expect(parsed.rows[1]?.cells).toEqual(["beta", "line 1\nline 2"]);
	});

	test("normalizes empty and duplicate headers", () => {
		const parsed = parseCsv("name,name,\nalpha,beta,gamma");

		expect(parsed.columns).toEqual(["name", "name 2", "Column 3"]);
	});

	test("returns an empty result for empty CSV", () => {
		const parsed = parseCsv("");

		expect(parsed.columns).toEqual([]);
		expect(parsed.rows).toEqual([]);
	});
});
