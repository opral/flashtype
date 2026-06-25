// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { normalizeAst, parseMarkdown, serializeAst } from "../markdown";

type Ast = any;

function roundtrip(ast: Ast): Ast {
	const pmDoc = astToTiptapDoc(ast);
	const out = tiptapDocToAst(pmDoc);
	return out;
}

function roundtripThroughEditor(ast: Ast): Ast {
	const pmDoc = astToTiptapDoc(ast);
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: pmDoc,
	});
	const outJSON = editor.getJSON();
	const result = tiptapDocToAst(outJSON);
	editor.destroy();
	return result;
}

function roundtripMarkdownThroughEditor(markdown: string): string {
	const ast = parseMarkdown(markdown);
	const editorAst = roundtripThroughEditor(ast);
	return serializeAst(editorAst);
}

function stripNullData(value: any): any {
	if (Array.isArray(value)) {
		return value.map(stripNullData);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const out: Record<string, any> = {};
	for (const [key, inner] of Object.entries(value)) {
		if (key === "data" && inner == null) continue;
		out[key] = stripNullData(inner);
	}
	return out;
}

function canonicalAst(ast: Ast): Ast {
	return stripNullData(normalizeAst(ast));
}

describe("root & paragraph", () => {
	test("simple paragraph", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [{ type: "text", value: "Hello world." }],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});
});

describe("vendor data roundtrip", () => {
	test("data.id and arbitrary keys survive ast → pm → ast", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "heading",
					depth: 2,
					data: { id: "H1", foo: "bar", nested: { a: 1 } },
					children: [{ type: "text", value: "Title" }],
				},
				{
					type: "paragraph",
					data: { id: "P1", custom: { x: 42 } },
					children: [{ type: "text", value: "Content" }],
				},
			],
		};

		const pm = astToTiptapDoc(input);
		const output = tiptapDocToAst(pm);

		// Expect full structural equality including data.* preservation
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
	});
});

describe("heading", () => {
	for (let level = 1 as 1 | 2 | 3 | 4 | 5 | 6; level <= 6; level++) {
		test(`h${level}`, () => {
			const input: Ast = {
				type: "root",
				children: [
					{
						type: "heading",
						depth: level,
						children: [{ type: "text", value: "Heading" }],
					},
				],
			};
			const output = roundtrip(input);
			expect(canonicalAst(output)).toEqual(canonicalAst(input));
			const editorOutput = roundtripThroughEditor(input);
			expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
		});
	}
});

describe("paragraph marks", () => {
	test("bold + italic + text", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "text", value: "Hello " },
						{ type: "strong", children: [{ type: "text", value: "world" }] },
						{ type: "text", value: " and " },
						{
							type: "emphasis",
							children: [{ type: "text", value: "friends" }],
						},
						{ type: "text", value: "." },
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("strong only", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "strong", children: [{ type: "text", value: "bold" }] },
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("italic only", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "emphasis", children: [{ type: "text", value: "italic" }] },
					],
				},
			],
		} as any;
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("inline code", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [{ type: "inlineCode", value: "code" }],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("strikethrough", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "delete", children: [{ type: "text", value: "strike" }] },
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("link with text and title", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{
							type: "link",
							url: "https://example.com",
							title: "title",
							children: [{ type: "text", value: "text" }],
						},
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	// <link> is a valid markdown form
	test.skip("link retains literal bracket syntax when label matches url", () => {
		const markdown = "[https://agents.md/](https://agents.md/)";
		const roundtripped = roundtripMarkdownThroughEditor(markdown);
		expect(roundtripped).toBe(markdown);
	});
});

describe("unsupported blocks", () => {
	test("html block preserved through editor", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "html",
					value: '<div class="hero">Welcome</div>',
					data: { id: "html_1" },
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("yaml frontmatter preserved through editor", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "yaml",
					value: "title: Demo\nlayout: doc",
					data: { id: "yaml_1" },
				},
				{
					type: "paragraph",
					children: [{ type: "text", value: "Hello" }],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});
});

describe("inline HTML", () => {
	test("inline html inside paragraph survives editor", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "text", value: "Hello" },
						{ type: "html", value: "<span class='pill'>beta</span>" },
						{ type: "text", value: "world" },
					],
				},
			],
		};
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});
});

describe("lists", () => {
	test("unordered", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "list",
					ordered: false,
					children: [
						{
							type: "listItem",
							children: [
								{
									type: "paragraph",
									children: [{ type: "text", value: "one" }],
								},
							],
						},
						{
							type: "listItem",
							children: [
								{
									type: "paragraph",
									children: [{ type: "text", value: "two" }],
								},
							],
						},
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("ordered (start omitted = 1)", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "list",
					ordered: true,
					children: [
						{
							type: "listItem",
							children: [
								{
									type: "paragraph",
									children: [{ type: "text", value: "one" }],
								},
							],
						},
						{
							type: "listItem",
							children: [
								{
									type: "paragraph",
									children: [{ type: "text", value: "two" }],
								},
							],
						},
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("ordered with start=3", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "list",
					ordered: true,
					start: 3,
					children: [
						{
							type: "listItem",
							children: [
								{
									type: "paragraph",
									children: [{ type: "text", value: "three" }],
								},
							],
						},
						{
							type: "listItem",
							children: [
								{
									type: "paragraph",
									children: [{ type: "text", value: "four" }],
								},
							],
						},
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("task list (checked/unchecked)", () => {
		const input: Ast = {
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
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		// Editor roundtrip of task list is exercised in the example app; core mapping equality is asserted here.
	});

	test("task list markdown preserves checked markers through editor serialization", () => {
		const markdown = "- [x] done\n- [ ] todo\n";

		expect(roundtripMarkdownThroughEditor(markdown)).toBe(markdown);
	});

	test("mixed plain and formatted task list markdown preserves markers", () => {
		const markdown =
			"- plain bullet\n- [ ] unchecked **bold**\n- [x] checked _italic_\n";

		expect(roundtripMarkdownThroughEditor(markdown)).toBe(markdown);
	});
});

describe("blocks", () => {
	test("blockquote", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "blockquote",
					children: [
						{ type: "paragraph", children: [{ type: "text", value: "quote" }] },
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
	});

	test("table", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "table",
					align: [null, null],
					children: [
						{
							type: "tableRow",
							children: [
								{ type: "tableCell", children: [{ type: "text", value: "a" }] },
								{ type: "tableCell", children: [{ type: "text", value: "b" }] },
							],
						},
						{
							type: "tableRow",
							children: [
								{ type: "tableCell", children: [{ type: "text", value: "1" }] },
								{ type: "tableCell", children: [{ type: "text", value: "2" }] },
							],
						},
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
		const editorOutput = roundtripThroughEditor(input);
		expect(canonicalAst(editorOutput)).toEqual(canonicalAst(input));
	});

	test("thematic break", () => {
		const input: Ast = { type: "root", children: [{ type: "thematicBreak" }] };
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
	});

	test("code block", () => {
		const input: Ast = {
			type: "root",
			children: [{ type: "code", lang: "js", value: "const a = 1" }],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
	});

	test("code block without lang", () => {
		const input: Ast = {
			type: "root",
			children: [{ type: "code", value: "plain" }],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
	});
});

describe("inline", () => {
	test("hard break", () => {
		const input: Ast = {
			type: "root",
			children: [
				{
					type: "paragraph",
					children: [
						{ type: "text", value: "line" },
						{ type: "break" },
						{ type: "text", value: "break" },
					],
				},
			],
		};
		const output = roundtrip(input);
		expect(canonicalAst(output)).toEqual(canonicalAst(input));
	});
});
