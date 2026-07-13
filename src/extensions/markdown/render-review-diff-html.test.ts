import { describe, expect, test } from "vitest";
import {
	bundledPluginArchives,
	openLix,
	type Lix,
} from "@/test-utils/node-lix-sdk";
import {
	MARKDOWN_DIFF_FIXTURES,
	type MarkdownDiffFixture,
} from "./diff-fixtures";
import { renderMarkdownReviewDiffHtml } from "./render-review-diff-html";
import type { MarkdownBlockSnapshot } from "./review-diff";
import { historicalMarkdownNodeBlocks } from "./markdown-node-history";

describe("renderMarkdownReviewDiffHtml", () => {
	test("marks added headings and blocks", () => {
		const html = renderMarkdownReviewDiffHtml({
			beforeMarkdown: "# Title\n\nBody\n",
			afterMarkdown: "# Title\n\nBody\n\n## Poem\n\nFresh line\n",
		});

		expect(html).toContain("<h2");
		expect(html).toContain('data-diff-status="added"');
		expect(html).toContain(">Poem</h2>");
		expect(html).toContain(">Fresh line</p>");
		expect(html.trim().startsWith("<h1")).toBe(true);
		expect(html).not.toContain("</h1>\n");
	});

	test("marks removed blocks", () => {
		const html = renderMarkdownReviewDiffHtml({
			beforeMarkdown: "# Title\n\nDelete me\n\nKeep me\n",
			afterMarkdown: "# Title\n\nKeep me\n",
		});

		expect(html).toContain('data-diff-status="removed"');
		expect(html).toContain(">Delete me</p>");
	});

	test("marks inline word replacements as removed and added", () => {
		const html = renderMarkdownReviewDiffHtml({
			beforeMarkdown: "# Strategy\n\nTarget a general audience.\n",
			afterMarkdown: "# Strategy\n\nTarget writers already using Claude.\n",
		});

		expect(html).toContain('data-diff-status="removed"');
		expect(html).toContain('data-diff-status="added"');
		expect(html).toContain("general audience");
		expect(html).toContain("writers already using Claude");
	});

	test("uses markdown block ids when snapshots are available", () => {
		const html = renderMarkdownReviewDiffHtml({
			beforeMarkdown: "# Strategy\n\nTarget a general audience.\n",
			afterMarkdown: "# Strategy\n\nTarget writers already using Claude.\n",
			beforeBlocks: [
				{ id: "heading_block", orderKey: "40", block: "# Strategy" },
				{
					id: "paragraph_block",
					orderKey: "80",
					block: "Target a general audience.",
				},
			],
			afterBlocks: [
				{ id: "heading_block", orderKey: "40", block: "# Strategy" },
				{
					id: "paragraph_block",
					orderKey: "80",
					block: "Target writers already using Claude.",
				},
			],
		});

		expect(html).toContain('data-diff-key="paragraph_block"');
		expect(html).toContain("general audience");
		expect(html).toContain("writers already using Claude");
	});

	test("uses markdown block snapshots when one side is empty", () => {
		const html = renderMarkdownReviewDiffHtml({
			beforeMarkdown: "",
			afterMarkdown: "# New document\n",
			beforeBlocks: [],
			afterBlocks: [
				{ id: "new_document_heading", orderKey: "40", block: "# New document" },
			],
		});

		expect(html).toContain('data-diff-key="new_document_heading"');
		expect(statusesForText(html, "New document")).toContain("added");
	});

	test("resolves image sources in review diffs", () => {
		const resolveImageSrc = (src: string) => `file:///workspace/docs/${src}`;
		const fullDocumentHtml = renderMarkdownReviewDiffHtml(
			{
				beforeMarkdown: "![Lix mark](./lix-mark-2.svg)\n",
				afterMarkdown: "![Lix mark](./lix-mark-3.svg)\n",
			},
			{ resolveImageSrc },
		);

		expect(imageSrcsForAlt(fullDocumentHtml, "Lix mark")).toEqual([
			"file:///workspace/docs/./lix-mark-2.svg",
			"file:///workspace/docs/./lix-mark-3.svg",
		]);
		expect(fullDocumentHtml).not.toContain('src="./lix-mark');

		const snapshotHtml = renderMarkdownReviewDiffHtml(
			{
				beforeMarkdown: "![Lix mark](./lix-mark-2.svg)\n",
				afterMarkdown: "![Lix mark](./lix-mark-3.svg)\n",
				beforeBlocks: [
					{
						id: "image_block",
						orderKey: "40",
						block: "![Lix mark](./lix-mark-2.svg)",
					},
				],
				afterBlocks: [
					{
						id: "image_block",
						orderKey: "40",
						block: "![Lix mark](./lix-mark-3.svg)",
					},
				],
			},
			{ resolveImageSrc },
		);

		expect(imageSrcsForAlt(snapshotHtml, "Lix mark")).toEqual([
			"file:///workspace/docs/./lix-mark-2.svg",
			"file:///workspace/docs/./lix-mark-3.svg",
		]);
		expect(snapshotHtml).not.toContain('src="./lix-mark');
	});

	test("keeps unchanged list items stable inside a changed list block", () => {
		const fixture = fixtureById("quick-facts-list");
		const html = renderMarkdownReviewDiffHtml(fixture);

		expect(statusesForText(html, "Best for")).toEqual([]);
		expect(statusesForText(html, "Trip length")).toEqual([]);
		expect(statusesForText(html, "Pace")).toEqual([]);
		expect(statusesForText(html, "regional trains")).toContain("added");
		expect(statusesForText(html, "Budget")).toContain("added");
	});

	test("keeps unchanged table cells stable inside a changed table block", () => {
		const fixture = fixtureById("plan-table");
		const html = renderMarkdownReviewDiffHtml(fixture);

		expect(statusesForText(html, "Friday")).toEqual([]);
		expect(statusesForText(html, "Mitte")).toEqual([]);
		expect(statusesForText(html, "Coffee near Hackescher Markt")).toEqual([]);
		expect(statusesForText(html, "and the Berliner Dom")).toContain("added");
		expect(statusesForText(html, "neighborhood wandering")).toContain("added");
	});

	test("marks inline formatting and link edits inside aligned GFM table cells", () => {
		const fixture = fixtureById("gfm-table-inline");
		const html = renderMarkdownReviewDiffHtml(fixture);

		expect(html).toContain("<table");
		expect(statusesForText(html, "South")).toEqual([]);
		expect(statusesForText(html, "Blocked")).toEqual([]);
		expect(statusesForText(html, "Shipped")).toEqual([]);
		expect(statusesForText(html, "Draft")).toContain("removed");
		expect(statusesForText(html, "Ready")).toContain("added");
		expect(statusesForText(html, "Lovelace")).toContain("added");
		expect(statusesForText(html, "smoke")).toContain("removed");
		expect(statusesForText(html, "full")).toContain("added");
		expect(statusesForText(html, "db")).toContain("added");
		expect(statusesForText(html, "East")).toEqual([]);
		expect(statusesForText(html, "Paused")).toEqual([]);
		expect(statusesForText(html, "cache")).toEqual([]);
		expect(statusesForText(html, "parser")).toEqual([]);
		expect(hrefsForText(html, "Dee")).toEqual(["https://example.com/v2"]);
		expect(html).toContain("https://example.com/v2");
	});

	test("handles GFM table row reorder, insertions, removals, and duplicate labels", () => {
		const fixture = fixtureById("gfm-table-rows");
		const html = renderMarkdownReviewDiffHtml(fixture);

		expect(duplicateDiffKeys(html)).toEqual([]);
		expect(html).toContain("<table");
		expect(statusesForText(html, "Beta")).toEqual([]);
		expect(statusesForText(html, "Move this row unchanged")).toEqual([]);
		expect(statusesForText(html, "Keep copy stable")).toEqual([]);
		expect(statusesForText(html, "Duplicate label remains")).toEqual([]);
		expect(statusesForText(html, "Keep second stable cell")).toEqual([]);
		expect(html).toContain('data-diff-key="gfm_table_rows:tr:gamma:td:notes"');
		expect(html).toContain('data-diff-status="removed"');
		expect(html).toContain("Remove this row");
		expect(statusesForText(html, "Epsilon")).toContain("added");
		expect(statusesForText(html, "Insert this row")).toContain("added");
		expect(statusesForText(html, "Alpha")).toEqual([]);
	});

	test("handles GFM table column changes, empty cells, and pipe literals", () => {
		const fixture = fixtureById("gfm-table-structure");
		const html = renderMarkdownReviewDiffHtml(fixture);
		const root = htmlRoot(html);

		expect(root.querySelectorAll("tr")).toHaveLength(7);
		expect(root.querySelectorAll("tr")[2]?.querySelectorAll("td")).toHaveLength(
			5,
		);
		expect(statusesForText(html, "Item")).toEqual([]);
		expect(statusesForText(html, "Owner")).toEqual([]);
		expect(statusesForText(html, "Notes")).toEqual([]);
		expect(statusesForText(html, "Priority")).toContain("added");
		expect(statusesForText(html, "Legacy")).toEqual([]);
		expect(statusesForText(html, "Status")).toContain("added");
		expect(html).toContain(
			'data-diff-key="gfm_table_structure:tr:alpha:td:owner"',
		);
		expect(html).toContain(
			'data-diff-key="gfm_table_structure:tr:alpha:td:notes"',
		);

		expect(statusesForText(html, "Alpha")).toEqual([]);
		expect(statusesForText(html, "Mia")).toEqual([]);
		expect(statusesForText(html, "high")).toContain("added");
		expect(statusesForText(html, "Filled empty cell")).toContain("added");
		expect(statusesForText(html, "Pipe demo")).toEqual([]);
		expect(statusesForText(html, "Escaped")).toEqual([]);
		expect(statusesForText(html, "pipe and")).toEqual([]);
		expect(statusesForText(html, "b")).toContain("removed");
		expect(statusesForText(html, "c")).toContain("added");

		expect(statusesForText(html, "First duplicate keeps same note")).toEqual(
			[],
		);
		expect(statusesForText(html, "Second duplicate")).toEqual([]);
		expect(statusesForText(html, "will be edited")).toContain("removed");
		expect(statusesForText(html, "gets a modified note")).toContain("added");
		expect(statusesForText(html, "Column removal keeps row identity")).toEqual(
			[],
		);
		expect(statusesForText(html, "old")).toEqual([]);
		expect(statusesForText(html, "New row")).toContain("added");
		expect(
			statusesForText(html, "Inserted row with changed-ready content"),
		).toContain("added");
		expect(statusesForText(html, "blue")).toContain("added");
	});

	test("tracks task list checked-state and nested list edits", () => {
		const fixture = fixtureById("release-checklist");
		const html = renderMarkdownReviewDiffHtml(fixture);
		const root = htmlRoot(html);

		expect(root.querySelector("li ul")).not.toBeNull();
		expect(root.querySelector('li[data-task] input[type="checkbox"]')).not.toBe(
			null,
		);
		expect(taskCheckedStatesForText(html, "Confirm launch owner")).toEqual([
			true,
		]);
		expect(taskCheckedStatesForText(html, "Draft release notes")).toContain(
			true,
		);
		expect(taskCheckedStatesForText(html, "Confirm event names")).toContain(
			true,
		);
		expect(statusesForText(html, "Confirm launch owner")).toEqual([]);
		expect(statusesForText(html, "Draft release notes")).toEqual([]);
		expect(statusesForText(html, "for beta customers")).toContain("added");
		expect(statusesForText(html, "Schedule support handoff")).toEqual([]);
		expect(statusesForText(html, "Check conversion dashboard")).toEqual([]);
		expect(statusesForText(html, "Confirm event names")).toContain("added");
		expect(statusesForText(html, "Archive notes")).toEqual([]);
		expect(statusesForText(html, "Leave changelog draft untouched")).toEqual(
			[],
		);
		expect(statusesForText(html, "Announce internally")).toEqual([]);
	});

	test("keeps reordered duplicate task labels nested with checkbox DOM", () => {
		const fixture = fixtureById("duplicate-task-list");
		const html = renderMarkdownReviewDiffHtml(fixture);
		const root = htmlRoot(html);

		expect(duplicateDiffKeys(html)).toEqual([]);
		expect(root.querySelectorAll("li ul").length).toBeGreaterThanOrEqual(3);
		expect(
			root.querySelectorAll('li[data-task] input[type="checkbox"]').length,
		).toBeGreaterThanOrEqual(10);
		expect(taskCheckedStatesForText(html, "Prep")).toEqual([false, false]);
		expect(taskCheckedStatesForText(html, "Confirm venue")).toContain(false);
		expect(taskCheckedStatesForText(html, "Confirm venue")).toContain(true);
		expect(taskCheckedStatesForText(html, "Invite reviewers")).toContain(true);
		expect(taskCheckedStatesForText(html, "Send announcement")).toContain(true);
		expect(taskCheckedStatesForText(html, "Send announcement")).toContain(
			false,
		);

		expect(statusesForText(html, "Prep")).toEqual(["added", "removed"]);
		expect(statusesForText(html, "Update docs")).toEqual([]);
		expect(statusesForText(html, "Invite reviewers")).toEqual([]);
		expect(statusesForText(html, "Book rehearsal room")).toContain("added");
		expect(statusesForText(html, "Pack demo kit")).toEqual([
			"added",
			"removed",
		]);
	});

	test("handles GFM fenced code, blockquotes, raw HTML, strikethrough, and autolinks", () => {
		const fixture = fixtureById("gfm-edge-blocks");
		const html = renderMarkdownReviewDiffHtml(fixture);

		expect(html).toContain('data-diff-key="gfm_code_fence"');
		expect(html).toContain('data-diff-key="gfm_blockquote"');
		expect(html).toContain('data-diff-key="gfm_raw_html"');
		expect(html).toContain('data-diff-key="gfm_strikethrough"');
		expect(html).toContain('data-diff-key="gfm_autolink"');

		expect(statusesForText(html, "const route")).toEqual([]);
		expect(statusesForText(html, "draft")).toContain("removed");
		expect(statusesForText(html, "launch")).toContain("added");
		expect(statusesForText(html, 'cache: "no-store"')).toContain("added");

		expect(statusesForText(html, "Keep the customer quote")).toEqual([]);
		expect(statusesForText(html, "current")).toContain("removed");
		expect(statusesForText(html, "revised")).toContain("added");
		expect(statusesForText(html, "Add a rollout owner")).toContain("added");

		expect(statusesForText(html, "HTML block (read only)")).toEqual([
			"added",
			"removed",
		]);
		expect(statusesForText(html, "Keep a short migration note")).toEqual([
			"added",
			"removed",
		]);
		expect(statusesForText(html, "and link to support")).toContain("added");
		expect(statusesForText(html, "invite-only")).toContain("removed");
		expect(statusesForText(html, "private")).toContain("added");
		expect(statusesForText(html, "docs")).toContain("removed");
		expect(statusesForText(html, "guides")).toContain("added");
	});

	test("handles moved headings, media, breaks, HTML, code language, quotes, and autolinks", () => {
		const fixture = fixtureById("block-media-link");
		const html = renderMarkdownReviewDiffHtml(fixture);
		const root = htmlRoot(html);

		expect(root.querySelectorAll("img")).toHaveLength(2);
		expect(root.querySelector('img[alt="Old dashboard"]')).not.toBeNull();
		expect(root.querySelector('img[alt="New dashboard"]')).not.toBeNull();
		expect(root.querySelectorAll("hr")).toHaveLength(1);
		expect(
			root.querySelector('hr[data-diff-key="theme_break"]'),
		).not.toBeNull();
		expect(root.querySelector("code.language-ts")).not.toBeNull();
		expect(html).toContain("&lt;kbd&gt;");
		expect(html).toContain('&lt;span data-kind="badge"&gt;');

		expect(statusesForText(html, "Launch notes")).toEqual([]);
		expect(statusesForText(html, "Metrics")).toEqual([]);
		expect(statusesForText(html, "renamed")).toContain("added");

		expect(statusesForSelector(html, 'img[alt="Old dashboard"]')).toEqual([
			"removed",
		]);
		expect(statusesForSelector(html, 'img[alt="New dashboard"]')).toEqual([
			"added",
		]);

		expect(statusesForText(html, "export const enabled")).toEqual([]);
		expect(statusesForText(html, "false")).toContain("removed");
		expect(statusesForText(html, "true")).toContain("added");

		expect(statusesForText(html, "Keep")).toEqual([]);
		expect(statusesForText(html, "bold")).toContain("removed");
		expect(statusesForText(html, "strong")).toContain("added");
		expect(statusesForText(html, "calm")).toContain("removed");
		expect(statusesForText(html, "focused")).toContain("added");
		expect(statusesForText(html, "owner")).toContain("added");

		expect(statusesForText(html, "docs")).toContain("removed");
		expect(statusesForText(html, "guides")).toContain("added");
		expect(statusesForText(html, "team")).toContain("removed");
		expect(statusesForText(html, "help")).toContain("added");

		expect(statusesForText(html, "Cmd")).toContain("removed");
		expect(statusesForText(html, "Ctrl")).toContain("added");
		expect(statusesForText(html, "beta")).toContain("removed");
		expect(statusesForText(html, "stable")).toContain("added");
		expect(statusesForText(html, "Raw block content")).toEqual([
			"added",
			"removed",
		]);
		expect(statusesForText(html, "plus owner")).toContain("added");
	});

	test("covers inline media, reference links, autolinks, escaped markdown, and breaks", () => {
		const fixture = fixtureById("inline-media-link");
		const html = renderMarkdownReviewDiffHtml(fixture);
		const root = htmlRoot(html);

		expect(statusesForText(html, "Inline media and links")).toEqual([]);
		expect(statusesForText(html, "emoji :) around")).toEqual([]);
		expect(statusesForText(html, "bold")).toContain("removed");
		expect(statusesForText(html, "strong")).toContain("added");
		expect(statusesForText(html, "code")).toContain("removed");
		expect(statusesForText(html, "snippet")).toContain("added");
		expect(statusesForText(html, "strike")).toContain("removed");
		expect(statusesForText(html, "retired")).toContain("added");
		expect(statusesForText(html, "punctuation")).toEqual([]);
		expect(statusesForText(html, "!")).toContain("removed");
		expect(statusesForText(html, "?")).toContain("added");

		expect(statusesForText(html, "Docs")).toContain("removed");
		expect(statusesForText(html, "Guides")).toContain("added");
		expect(hrefsForText(html, "Guides")).toEqual([]);
		expect(statusesForText(html, "API")).toEqual([]);
		expect(hrefsForText(html, "API")).toEqual([]);

		expect(statusesForText(html, "Reference")).toEqual([]);
		expect(hrefsForText(html, "Guidebook")).toEqual([]);
		expect(statusesForSelector(html, 'img[alt="Reference logo"]')).toEqual([]);
		expect(statusesForSelector(html, 'img[alt="Reference logo new"]')).toEqual(
			[],
		);

		expect(hrefsForText(html, "https://example.com/bare-v2")).toEqual([]);
		expect(hrefsForText(html, "ops-v2@example.com")).toEqual([]);
		expect(statusesForText(html, "v1")).toContain("removed");
		expect(statusesForText(html, "v2")).toContain("added");

		expect(statusesForText(html, "stars")).toContain("removed");
		expect(statusesForText(html, "asterisks")).toContain("added");
		expect(statusesForText(html, "link")).toContain("removed");
		expect(statusesForText(html, "reference")).toContain("added");

		expect(root.querySelectorAll("br")).toHaveLength(0);
		expect(statusesForText(html, "Soft break stays here")).toEqual([]);
		expect(statusesForText(html, "with the next line")).toEqual([]);
		expect(statusesForText(html, "updated")).toContain("added");
		expect(statusesForText(html, "hard break stays here")).toEqual([]);
		expect(statusesForText(html, "with the forced line")).toEqual([]);

		expect(statusesForSelector(html, 'img[alt="Removed chart"]')).toContain(
			"removed",
		);
		expect(statusesForSelector(html, 'img[alt="Added chart"]')).toEqual([
			"added",
		]);
		expect(imageTitlesForAlt(html, "Added chart")).toEqual(["Added title"]);
		expect(statusesForSelector(html, 'img[alt="Screenshot old alt"]')).toEqual(
			[],
		);
		expect(statusesForSelector(html, 'img[alt="Screenshot new alt"]')).toEqual(
			[],
		);
		expect(imageTitlesForAlt(html, "Screenshot new alt")).toEqual([
			"New screenshot title",
		]);
	});

	test("handles block moves, heading levels, lifecycle blocks, and repeated text", () => {
		const fixture = fixtureById("block-structure-moves");
		const html = renderMarkdownReviewDiffHtml(fixture);
		const root = htmlRoot(html);

		expect(html).toContain('data-diff-key="moved_paragraph"');
		expect(statusesForText(html, "Shared paragraph")).toEqual([]);
		expect(
			statusesForText(html, "Move this paragraph below the checklist"),
		).toEqual([]);
		expect(statusesForText(html, "Repeated heading")).toEqual([]);
		expect(statusesForText(html, "Keep the same repeated paragraph")).toEqual(
			[],
		);

		expect(root.querySelector("h2")?.textContent).toContain("Overview");
		expect(root.querySelector("h3")?.textContent).toContain("Details");
		expect(statusesForText(html, "Overview")).toEqual([]);
		expect(statusesForText(html, "Details")).toEqual([]);

		expect(statusesForText(html, "Parent quote stays")).toEqual([]);
		expect(statusesForText(html, "calm").length).toBeGreaterThan(0);
		expect(statusesForText(html, "focused")).toContain("added");
		expect(statusesForText(html, "Nested quote owner added")).toContain(
			"added",
		);

		expect(root.querySelector("code.language-ts")).not.toBeNull();
		expect(root.querySelector("code.language-sh")).not.toBeNull();
		expect(statusesForText(html, 'console.log("keep");')).toEqual([]);
		expect(statusesForText(html, 'console.log("remove me");')).toContain(
			"removed",
		);
		expect(statusesForText(html, 'echo "new fence"')).toContain("added");

		expect(root.querySelectorAll("hr")).toHaveLength(1);
		expect(
			root.querySelector('hr[data-diff-key="changed_theme_break"]'),
		).not.toBeNull();

		expect(statusesForText(html, "Paragraph before list")).toEqual([]);
		expect(statusesForText(html, "Keep list item")).toEqual([]);
		expect(statusesForText(html, "Move list with paragraph boundary")).toEqual(
			[],
		);
		expect(statusesForText(html, "Add list item between paragraphs")).toContain(
			"added",
		);
		expect(statusesForText(html, "Paragraph after list")).toEqual([]);

		expect(statusesForText(html, "Remove this HTML block")).toContain(
			"removed",
		);
		expect(statusesForText(html, "Add this HTML block")).toContain("added");
	});

	test.each([
		{
			id: "quick-facts-list",
			assertions: assertQuickFactsListDiff,
		},
		{
			id: "plan-table",
			assertions: assertPlanTableDiff,
		},
		{
			id: "release-checklist",
			assertions: assertReleaseChecklistDiff,
		},
		{
			id: "mixed-gfm-document",
			assertions: assertMixedGfmDocumentDiff,
		},
	])(
		"renders $id fixture diff from real Lix markdown_node history",
		async ({ id, assertions }) => {
			const fixture = fixtureById(id);
			const { html, beforeBlocks, afterBlocks } =
				await renderFixtureDiffFromRealLix(fixture);

			expect(beforeBlocks.length).toBeGreaterThan(0);
			expect(afterBlocks.length).toBeGreaterThan(0);
			expect(beforeBlocks.map((block) => block.block).join("\n\n")).toContain(
				fixture.beforeMarkdown.trim().split("\n")[0],
			);
			expect(afterBlocks.map((block) => block.block).join("\n\n")).toContain(
				fixture.afterMarkdown.trim().split("\n")[0],
			);

			if (id === "mixed-gfm-document") {
				expectStableRealLixBlockKeys(html, beforeBlocks, afterBlocks);
			}

			assertions(html);
		},
	);
});

async function renderFixtureDiffFromRealLix(
	fixture: MarkdownDiffFixture,
): Promise<{
	html: string;
	beforeBlocks: MarkdownBlockSnapshot[];
	afterBlocks: MarkdownBlockSnapshot[];
}> {
	const lix = await openLix();
	try {
		await installBundledPlugins(lix);
		const filePath = `/fixtures/${fixture.id}.md`;
		await writeMarkdownFile(lix, filePath, fixture.beforeMarkdown);
		const fileId = await fileIdByPath(lix, filePath);
		const beforeCommitId = await activeCommitId(lix);

		await writeMarkdownFile(lix, filePath, fixture.afterMarkdown);
		const afterCommitId = await activeCommitId(lix);
		const beforeBlocks = await historicalMarkdownBlocks(
			lix,
			beforeCommitId,
			fileId,
			fixture.beforeMarkdown,
		);
		const afterBlocks = await historicalMarkdownBlocks(
			lix,
			afterCommitId,
			fileId,
			fixture.afterMarkdown,
		);

		const html = renderMarkdownReviewDiffHtml({
			beforeMarkdown: fixture.beforeMarkdown,
			afterMarkdown: fixture.afterMarkdown,
			beforeBlocks,
			afterBlocks,
		});

		return { html, beforeBlocks, afterBlocks };
	} finally {
		await lix.close();
	}
}

function assertQuickFactsListDiff(html: string): void {
	expect(statusesForText(html, "Best for")).toEqual([]);
	expect(statusesForText(html, "Trip length")).toEqual([]);
	expect(statusesForText(html, "Pace")).toEqual([]);
	expect(statusesForText(html, "regional trains")).toContain("added");
	expect(statusesForText(html, "Budget")).toContain("added");
}

function assertPlanTableDiff(html: string): void {
	expect(html).toContain("<table");
	expect(statusesForText(html, "Friday")).toEqual([]);
	expect(statusesForText(html, "Mitte")).toEqual([]);
	expect(statusesForText(html, "Coffee near Hackescher Markt")).toEqual([]);
	expect(statusesForText(html, "and the Berliner Dom")).toContain("added");
	expect(statusesForText(html, "neighborhood wandering")).toContain("added");
}

function assertReleaseChecklistDiff(html: string): void {
	const root = htmlRoot(html);

	expect(root.querySelector("li ul")).not.toBeNull();
	expect(root.querySelector('li[data-task] input[type="checkbox"]')).not.toBe(
		null,
	);
	expect(statusesForText(html, "Confirm launch owner")).toEqual([]);
	expect(statusesForText(html, "Draft release notes")).toEqual([]);
	expect(statusesForText(html, "for beta customers")).toContain("added");
	expect(statusesForText(html, "Confirm event names")).toContain("added");
	expect(statusesForText(html, "Announce internally")).toEqual([]);
}

function assertMixedGfmDocumentDiff(html: string): void {
	const root = htmlRoot(html);

	expect(root.querySelector("table")).not.toBeNull();
	expect(root.querySelector("code.language-ts")).not.toBeNull();
	expect(root.querySelector('li[data-task] input[type="checkbox"]')).not.toBe(
		null,
	);

	expect(statusesForText(html, "Launch review")).toEqual([]);
	expect(statusesForText(html, "Read the")).toEqual([]);
	expect(statusesForText(html, "ops@example.com")).toEqual([]);
	expect(hrefsForText(html, "runbook")).toEqual([
		"https://example.com/runbook-v2",
	]);

	expect(statusesForText(html, "API")).toEqual([]);
	expect(statusesForText(html, "Dee")).toEqual([]);
	expect(statusesForText(html, "Ready")).toEqual([]);
	expect(statusesForText(html, "Draft")).toContain("removed");
	expect(statusesForText(html, "Approved")).toContain("added");
	expect(statusesForText(html, "Billing")).toContain("added");
	expect(statusesForText(html, "Watching")).toContain("added");

	expect(taskCheckedStatesForText(html, "Confirm launch owner")).toEqual([
		true,
	]);
	expect(taskCheckedStatesForText(html, "Update docs")).toEqual([true]);
	expect(statusesForText(html, "Confirm launch owner")).toEqual([]);
	expect(statusesForText(html, "Keep migration note")).toEqual([]);
	expect(statusesForText(html, "Verify search index")).toEqual([]);
	expect(statusesForText(html, "Add rollback note")).toContain("added");

	expect(statusesForText(html, 'notify("ops")')).toEqual([]);
	expect(statusesForText(html, "staged")).toContain("removed");
	expect(statusesForText(html, "global")).toContain("added");
	expect(statusesForText(html, 'notify("support")')).toContain("added");
}

function expectStableRealLixBlockKeys(
	html: string,
	beforeBlocks: MarkdownBlockSnapshot[],
	afterBlocks: MarkdownBlockSnapshot[],
): void {
	const stableAnchors = [
		"Launch review",
		"ops@example.com",
		"Area",
		"Confirm launch owner",
		'notify("ops")',
	];

	for (const anchor of stableAnchors) {
		const beforeId = blockIdContaining(beforeBlocks, anchor);
		const afterId = blockIdContaining(afterBlocks, anchor);
		expect(beforeId, `before block id for ${anchor}`).toBeTruthy();
		expect(afterId, `after block id for ${anchor}`).toBe(beforeId);
		expect(hasDiffKeyForBlock(html, afterId!)).toBe(true);
	}
}

function hasDiffKeyForBlock(html: string, blockId: string): boolean {
	return (
		html.includes(`data-diff-key="${blockId}"`) ||
		html.includes(`data-diff-key="${blockId}:`)
	);
}

function blockIdContaining(
	blocks: MarkdownBlockSnapshot[],
	text: string,
): string | undefined {
	return blocks.find((block) => block.block.includes(text))?.id;
}

function fixtureById(id: string) {
	const fixture = MARKDOWN_DIFF_FIXTURES.find((entry) => entry.id === id);
	if (!fixture) throw new Error(`Missing markdown diff fixture '${id}'`);
	return fixture;
}

function statusesForText(html: string, text: string): string[] {
	const root = htmlRoot(html);
	const statuses = new Set<string>();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		if (node.textContent?.includes(text)) {
			const status = nearestDiffStatus(parentElementForNode(node));
			if (status) statuses.add(status);
		}
		node = walker.nextNode();
	}
	return [...statuses].sort();
}

function statusesForSelector(html: string, selector: string): string[] {
	const root = htmlRoot(html);
	return [...root.querySelectorAll(selector)]
		.map((element) => nearestDiffStatus(element))
		.filter((status): status is string => status !== null)
		.sort();
}

function hrefsForText(html: string, text: string): string[] {
	const root = htmlRoot(html);
	return [...root.querySelectorAll("a")]
		.filter((link) => link.textContent?.includes(text))
		.map((link) => link.getAttribute("href"))
		.filter((href): href is string => href !== null)
		.sort();
}

function imageTitlesForAlt(html: string, alt: string): string[] {
	const root = htmlRoot(html);
	return [...root.querySelectorAll("img")]
		.filter((image) => image.getAttribute("alt") === alt)
		.map((image) => image.getAttribute("title"))
		.filter((title): title is string => title !== null)
		.sort();
}

function imageSrcsForAlt(html: string, alt: string): string[] {
	const root = htmlRoot(html);
	return [...root.querySelectorAll("img")]
		.filter((image) => image.getAttribute("alt") === alt)
		.map((image) => image.getAttribute("src"))
		.filter((src): src is string => src !== null)
		.sort();
}

function htmlRoot(html: string): HTMLDivElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	return root;
}

function duplicateDiffKeys(html: string): string[] {
	const root = htmlRoot(html);
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const element of root.querySelectorAll("[data-diff-key]")) {
		const key = element.getAttribute("data-diff-key");
		if (!key) continue;
		if (seen.has(key)) duplicates.add(key);
		seen.add(key);
	}
	return [...duplicates].sort();
}

function taskCheckedStatesForText(html: string, text: string): boolean[] {
	const root = htmlRoot(html);
	return [...root.querySelectorAll("li[data-task]")]
		.filter((item) => listItemOwnText(item).includes(text))
		.map((item) => {
			const checkbox = item.querySelector<HTMLInputElement>(
				'input[type="checkbox"]',
			);
			if (!checkbox) throw new Error(`Missing checkbox for task '${text}'`);
			return checkbox.checked;
		});
}

function listItemOwnText(item: Element): string {
	let text = "";
	for (const child of item.childNodes) {
		if (
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName === "UL"
		) {
			continue;
		}
		text += child.textContent ?? "";
	}
	return text.replace(/\s+/g, " ").trim();
}

function parentElementForNode(node: Node): Element | null {
	const parent = node.parentNode;
	return parent?.nodeType === Node.ELEMENT_NODE ? (parent as Element) : null;
}

function nearestDiffStatus(element: Element | null): string | null {
	let current: Element | null = element;
	while (current) {
		const status = current.getAttribute("data-diff-status");
		if (status) return status;
		current = current.parentElement;
	}
	return null;
}

async function writeMarkdownFile(
	lix: Lix,
	path: string,
	markdown: string,
): Promise<void> {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES (?, ?) \
		 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[path, new TextEncoder().encode(markdown)],
	);
}

async function installBundledPlugins(lix: Lix): Promise<void> {
	for (const plugin of await bundledPluginArchives()) {
		await lix.execute(
			"INSERT INTO lix_file (path, data) VALUES (?, ?) \
			 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
			[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
		);
	}
}

async function fileIdByPath(lix: Lix, path: string): Promise<string> {
	const result = await lix.execute("SELECT id FROM lix_file WHERE path = ?", [
		path,
	]);
	const id = result.rows[0]?.get("id");
	if (typeof id !== "string") throw new Error(`Missing file id for ${path}`);
	return id;
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute("SELECT lix_active_branch_commit_id()");
	const commitId = result.rows[0]?.get("lix_active_branch_commit_id()");
	if (typeof commitId !== "string") {
		throw new Error("Missing active branch commit id");
	}
	return commitId;
}

async function historicalMarkdownBlocks(
	lix: Lix,
	commitId: string,
	fileId: string,
	markdown: string,
): Promise<MarkdownBlockSnapshot[]> {
	const result = await lix.execute(
		`
			WITH ranked AS (
				SELECT
					snapshot_content,
					ROW_NUMBER() OVER (
						PARTITION BY entity_pk
						ORDER BY depth ASC
					) AS rn
				FROM lix_state_history
				WHERE start_commit_id = ?
					AND file_id = ?
					AND schema_key = 'markdown_node'
			)
			SELECT snapshot_content
			FROM ranked
			WHERE rn = 1
				AND snapshot_content IS NOT NULL
		`,
		[commitId, fileId],
	);
	return (
		historicalMarkdownNodeBlocks(
			result.rows.map((row) => ({
				start_commit_id: commitId,
				snapshot_content: row.get("snapshot_content"),
			})),
			commitId,
			markdown,
		) ?? []
	);
}
