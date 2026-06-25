import { describe, expect, test } from "vitest";
import { normalizeAst, parseMarkdown, serializeAst } from "./markdown";

describe("markdown parser", () => {
	test("parses GFM tables with inline content and alignment", () => {
		const ast = parseMarkdown("| A | B |\n| :- | -: |\n| **a** | `b` |\n");
		const table = ast.children[0];

		expect(table?.type).toBe("table");
		expect(table?.align).toEqual(["left", "right"]);
		expect(table?.children?.[1]?.children?.[0]?.children).toEqual([
			{ type: "strong", children: [{ type: "text", value: "a" }] },
		]);
		expect(table?.children?.[1]?.children?.[1]?.children).toEqual([
			{ type: "inlineCode", value: "b" },
		]);
	});

	test("parses task lists", () => {
		const ast = parseMarkdown("- [ ] todo\n- [x] done\n");
		const items = ast.children[0]?.children;

		expect(ast.children[0]?.type).toBe("list");
		expect(items?.[0]?.checked).toBe(false);
		expect(items?.[1]?.checked).toBe(true);
		expect(items?.[0]?.children?.[0]?.children).toEqual([
			{ type: "text", value: "todo" },
		]);
	});

	test("parses YAML frontmatter", () => {
		const ast = parseMarkdown("---\ntitle: Demo\n---\n\nBody");

		expect(ast.children[0]).toEqual({
			type: "yaml",
			value: "title: Demo",
		});
		expect(ast.children[1]?.type).toBe("paragraph");
	});

	test("parses reference links, reference images, and autolinks", () => {
		const ast = parseMarkdown(
			[
				"Reference [Guide][guide] and ![Logo][logo].",
				"",
				"Bare https://example.com and <ops@example.com>.",
				"",
				"[guide]: https://example.com/guide",
				'[logo]: https://example.com/logo.png "Logo"',
			].join("\n"),
		);
		const firstParagraphInline = ast.children[0]?.children ?? [];
		const secondParagraphLinks = collectNodes(ast.children[1], "link");

		expect(firstParagraphInline).toContainEqual({
			type: "link",
			title: null,
			url: "https://example.com/guide",
			children: [{ type: "text", value: "Guide" }],
		});
		expect(firstParagraphInline).toContainEqual({
			type: "image",
			title: "Logo",
			url: "https://example.com/logo.png",
			alt: "Logo",
		});
		expect(secondParagraphLinks.map((node) => node.url)).toEqual([
			"https://example.com",
			"mailto:ops@example.com",
		]);
	});

	test("parses inline HTML and hard breaks", () => {
		const ast = parseMarkdown("Use <kbd>Ctrl</kbd>  \nnext");
		const inline = ast.children[0]?.children ?? [];

		expect(inline).toContainEqual({ type: "html", value: "<kbd>" });
		expect(inline).toContainEqual({ type: "html", value: "</kbd>" });
		expect(inline).toContainEqual({ type: "break" });
	});

	test("parses block HTML", () => {
		const ast = parseMarkdown("<section>\nRaw\n</section>");

		expect(ast.children[0]).toEqual({
			type: "html",
			value: "<section>\nRaw\n</section>",
		});
	});

	test("parses code fence metadata", () => {
		const ast = parseMarkdown("```ts meta\nconst x = 1;\n```");

		expect(ast.children[0]).toEqual({
			type: "code",
			lang: "ts",
			meta: "meta",
			value: "const x = 1;",
		});
	});

	test("normalizes CRLF and Unicode text", () => {
		const ast = parseMarkdown("Cafe\u0301\r\nnext");

		expect(ast.children[0]?.children?.[0]).toEqual({
			type: "text",
			value: "Café\nnext",
		});
	});
});

describe("markdown serializer", () => {
	test("serializes task markers and preserves trailing newline", () => {
		expect(
			serializeAst({
				type: "root",
				children: [
					{
						type: "list",
						ordered: false,
						children: [
							{
								type: "listItem",
								checked: true,
								children: [
									{
										type: "paragraph",
										children: [{ type: "text", value: "done" }],
									},
								],
							},
							{
								type: "listItem",
								checked: false,
								children: [
									{
										type: "paragraph",
										children: [{ type: "text", value: "todo" }],
									},
								],
							},
						],
					},
				],
			}),
		).toBe("- [x] done\n- [ ] todo\n");
	});

	test("serializes code fence metadata", () => {
		expect(
			serializeAst({
				type: "root",
				children: [
					{
						type: "code",
						lang: "ts",
						meta: "meta",
						value: "const x = 1;",
					},
				],
			}),
		).toBe("```ts meta\nconst x = 1;\n```\n");
	});

	test("normalizes without mutating the input", () => {
		const input = {
			type: "root",
			position: { start: 1 },
			children: [{ type: "paragraph", children: [{ value: "Cafe\u0301\r" }] }],
		};

		expect(normalizeAst(input)).toEqual({
			type: "root",
			children: [{ type: "paragraph", children: [{ value: "Café\n" }] }],
		});
		expect(input).toEqual({
			type: "root",
			position: { start: 1 },
			children: [{ type: "paragraph", children: [{ value: "Cafe\u0301\r" }] }],
		});
	});
});

function collectNodes(node: any, type: string): any[] {
	const out: any[] = [];
	const visit = (current: any) => {
		if (!current || typeof current !== "object") return;
		if (current.type === type) out.push(current);
		for (const child of Array.isArray(current.children)
			? current.children
			: []) {
			visit(child);
		}
	};
	visit(node);
	return out;
}
