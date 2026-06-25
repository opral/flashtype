import { describe, expect, test } from "vitest";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import { parseCsv, renderCsvReviewDiffHtml } from "./index";

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
		const parsed = parseCsv(
			'name,notes\nalpha,"hello, world"\nbeta,"line 1\nline 2"',
		);

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

describe("renderCsvReviewDiffHtml", () => {
	const review = (
		beforeCsv: string,
		afterCsv: string,
	): ExternalWriteReview => ({
		fileId: "file_csv",
		path: "/data.csv",
		reviewId: "review_csv",
		beforeData: new TextEncoder().encode(beforeCsv),
		afterData: new TextEncoder().encode(afterCsv),
		beforeCommitId: "commit_before",
		afterCommitId: "commit_after",
		agentTurnRangeId: "agent_turn_range",
	});

	test("marks changed cells", () => {
		const html = renderCsvReviewDiffHtml(
			review("name,value\nalpha,1\nbeta,2", "name,value\nalpha,1\nbeta,3"),
		);

		expect(html).toContain('data-diff-status="removed"');
		expect(html).toContain('data-diff-status="added"');
		expect(html).toContain(">2</span>");
		expect(html).toContain(">3</span>");
	});

	test("marks added rows", () => {
		const html = renderCsvReviewDiffHtml(
			review("name,value\nalpha,1", "name,value\nalpha,1\nbeta,2"),
		);

		expect(html).toContain('data-diff-status="added"');
		expect(html).toContain(">beta</td>");
	});

	test("marks removed rows", () => {
		const html = renderCsvReviewDiffHtml(
			review("name,value\nalpha,1\nbeta,2", "name,value\nalpha,1"),
		);

		expect(html).toContain('data-diff-status="removed"');
		expect(html).toContain(">beta</td>");
	});

	test("does not reuse row keys when rows are inserted before existing rows", () => {
		const html = renderCsvReviewDiffHtml(
			review("name,value\nalpha,1", "name,value\nbeta,2\nalpha,1"),
		);

		const afterRowZeroMatches = html.match(/data-diff-key="after_row_0"/g);
		expect(afterRowZeroMatches).toHaveLength(1);
	});
});
