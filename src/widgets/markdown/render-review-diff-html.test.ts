import { describe, expect, test } from "vitest";
import { renderMarkdownReviewDiffHtml } from "./render-review-diff-html";

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
});
