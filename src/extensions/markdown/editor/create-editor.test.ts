import { test, expect } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createEditor } from "./create-editor";
import { astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown, serializeAst } from "./markdown-rust";
import { handlePaste } from "./handle-paste";
import { Editor } from "@tiptap/core";
import { qb } from "@/lib/lix-kysely";

const ensureTrailingNewline = (value: string) =>
	value.endsWith("\n") ? value : `${value}\n`;

async function readMarkdown(
	lix: Awaited<ReturnType<typeof openLix>>,
	fileId: string,
): Promise<string> {
	const row = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.select("data")
		.executeTakeFirst();
	return new TextDecoder().decode(row?.data ?? new Uint8Array());
}

async function waitForMarkdown(
	lix: Awaited<ReturnType<typeof openLix>>,
	fileId: string,
	matches: (markdown: string) => boolean,
): Promise<string> {
	let markdown = "";
	for (let i = 0; i < 40; i += 1) {
		markdown = await readMarkdown(lix, fileId);
		if (matches(markdown)) {
			return markdown;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return markdown;
}

function paragraphTexts(markdown: string): string[] {
	return markdown
		.trim()
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
}

function buildLongMarkdownRepro(): string {
	const parts = [
		"# Complex roundtrip document",
		"",
		"Opening paragraph with **bold**, _italic_, `inline code`, and [a link](https://example.com).",
		"",
	];
	for (let i = 1; i <= 36; i += 1) {
		parts.push(`## Section ${String(i).padStart(2, "0")}`);
		parts.push("");
		parts.push(
			`Paragraph ${i} alpha. This text should remain after edits, including punctuation: commas, semicolons; and parentheses (like this).`,
		);
		parts.push("");
		if (i % 3 === 0) {
			parts.push(`- Bullet ${i}.1 remains`);
			parts.push(`- Bullet ${i}.2 remains`);
			parts.push("");
		}
		if (i % 4 === 0) {
			parts.push(`- [ ] Todo ${i} remains unchecked`);
			parts.push(`- [x] Done ${i} remains checked`);
			parts.push("");
		}
		if (i % 5 === 0) {
			parts.push(`1. Ordered ${i}.1 remains`);
			parts.push(`2. Ordered ${i}.2 remains`);
			parts.push("");
		}
		if (i % 6 === 0) {
			parts.push(`> Quote ${i} should remain below edit points.`);
			parts.push("");
		}
		if (i === 18) {
			parts.push(
				"TARGET paragraph. Editing inside this line should not delete anything below it.",
			);
			parts.push("");
		}
	}
	parts.push("## Tail table");
	parts.push("");
	parts.push("| Name | Value |");
	parts.push("| - | - |");
	parts.push("| tail-a | survives |");
	parts.push("| tail-b | survives |");
	parts.push("");
	parts.push("```ts");
	parts.push('export const tail = "survives";');
	parts.push("```");
	parts.push("");
	parts.push("Final paragraph at the very bottom must survive mid-document edits.");
	return `${parts.join("\n")}\n`;
}

function positionAfterText(editor: Editor, needle: string): number {
	let found: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (found != null) return false;
		if (!node.isText) return true;
		const text = node.text ?? "";
		const index = text.indexOf(needle);
		if (index >= 0) {
			found = pos + index + needle.length;
			return false;
		}
		return true;
	});
	if (found == null) {
		throw new Error(`Could not find text in editor: ${needle}`);
	}
	return found;
}

async function createEditorFromFile(args: {
	lix: Awaited<ReturnType<typeof openLix>>;
	fileId: string;
	persistDebounceMs?: number;
}) {
	const row = await qb(args.lix)
		.selectFrom("lix_file")
		.where("id", "=", args.fileId)
		.select(["data"])
		.executeTakeFirst();

	const initialMarkdown = new TextDecoder().decode(
		row?.data ?? new Uint8Array(),
	);
	const editor = createEditor({
		lix: args.lix,
		fileId: args.fileId,
		initialMarkdown,
		persistDebounceMs: args.persistDebounceMs,
	});

	return editor;
}

// TipTap + Lix persistence paste tests (no React)
test("paste at start inserts before existing content (TipTap + Lix)", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	const fileId = "paste_start_before";

	// Seed initial file content
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-start.md",
			data: new TextEncoder().encode("Start"),
		})
		.execute();

	// Create editor from fileId (auto-loads initial content)
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Set cursor at start and simulate paste of plain text
	editor.commands.setTextSelection(1);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? "New" : ""),
			},
		},
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

	const mdAfter = await waitForMarkdown(
		lix,
		fileId,
		(markdown) => markdown === ensureTrailingNewline("New\n\nStart"),
	);
	expect(mdAfter).toBe(ensureTrailingNewline("New\n\nStart"));

	editor.destroy();
});

test("paste at end inserts after existing content (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_end_after";

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-end.md",
			data: new TextEncoder().encode("Start"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	const end = editor.state.doc.content.size;
	editor.commands.setTextSelection(end);
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? "New" : ""),
			},
		},
	});
	await new Promise((r) => setTimeout(r, 0));

	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();
	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toBe(ensureTrailingNewline("Start\n\nNew"));
	editor.destroy();
});

test("replace word selection with paste (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_replace_word";
	const initial = "Replace THIS TEXT here.";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-replace-word.md",
			data: new TextEncoder().encode(initial),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	// Select the substring "THIS TEXT" (roughly positions 9..18 in PM coords)
	editor.commands.setTextSelection({ from: 9, to: 18 });
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? "new content" : ""),
			},
		},
	});
	await new Promise((r) => setTimeout(r, 0));

	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();
	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toBe(ensureTrailingNewline("Replace new content here."));
	editor.destroy();
});

test("replace entire document with paste (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_replace_all";
	const initial = "Old content\n\nTo be replaced";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-replace-all.md",
			data: new TextEncoder().encode(initial),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	editor.commands.selectAll();
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) =>
					t === "text/plain" ? "# New Document\n\nCompletely new content" : "",
			},
		},
	});
	await new Promise((r) => setTimeout(r, 0));

	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();
	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toBe(
		ensureTrailingNewline("# New Document\n\nCompletely new content"),
	);
	editor.destroy();
});

test("paste multi-paragraph plain text into empty doc (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_plain_multi";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-plain-multi.md",
			data: new TextEncoder().encode(""),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) =>
					t === "text/plain" ? "First line\n\nSecond line" : "",
			},
		},
	});

	await new Promise((r) => setTimeout(r, 0));

	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();

	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toBe(ensureTrailingNewline("First line\n\nSecond line"));
	editor.destroy();
});

test("Enter splits paragraph into persisted markdown paragraphs", async () => {
	const lix = await openLix();
	const fileId = "enter_split_ids_unique";

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/enter-split.md",
			data: new TextEncoder().encode("Hello world."),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Place caret after "Hello"
	const para = editor.state.doc.child(0);
	const paraFrom = 1;
	const idxHello = para.textContent.indexOf("Hello");
	const posSplit = paraFrom + 1 + idxHello + "Hello".length;
	editor.commands.setTextSelection(posSplit);

	// Simulate an Enter key press
	const event = new KeyboardEvent("keydown", {
		key: "Enter",
		bubbles: true,
		cancelable: true,
	});
	editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));

	// Give onUpdate/persist a tick (persistDebounceMs=0 still runs async)
	await new Promise((r) => setTimeout(r, 0));

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 2,
	);
	expect(paragraphTexts(markdown)).toEqual(["Hello", "world."]);

	editor.destroy();
});

test("two Enters create three persisted paragraphs in order", async () => {
	const lix = await openLix();
	const fileId = "enter_split_three";

	// Seed with a single paragraph
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/enter-split-three.md",
			data: new TextEncoder().encode("Hello world"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Move caret to end and split → new empty paragraph (#2)
	const end = editor.state.doc.content.size;
	editor.commands.setTextSelection(end);
	editor.commands.splitBlock();
	// Type content for paragraph #2
	editor.commands.insertContent("How are you? ");

	// Split again → new paragraph (#3)
	editor.commands.splitBlock();
	editor.commands.insertContent("Good and you? ");

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 3,
	);
	expect(paragraphTexts(markdown)).toEqual([
		"Hello world",
		"How are you?",
		"Good and you?",
	]);

	editor.destroy();
});

test("normalize CRLF line endings on paste (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_crlf";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-crlf.md",
			data: new TextEncoder().encode(""),
		})
		.execute();
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) =>
					t === "text/plain" ? "Line one\r\n\r\nLine two" : "",
			},
		},
	});
	await new Promise((r) => setTimeout(r, 0));
	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();
	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toBe(ensureTrailingNewline("Line one\n\nLine two"));
	editor.destroy();
});

test("paste complex markdown with lists and code blocks (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_complex";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-complex.md",
			data: new TextEncoder().encode(""),
		})
		.execute();
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	const complex = `# Title\n\n- Item 1\n- Item 2\n\n\`\`\`javascript\nconst x = 1;\n\`\`\``;
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? complex : ""),
			},
		},
	});
	await new Promise((r) => setTimeout(r, 0));
	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();
	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toContain("# Title");
	expect(mdAfter).toContain("- Item 1");
	expect(mdAfter).toContain("- Item 2");
	expect(mdAfter).toContain("```javascript");
	expect(mdAfter).toContain("const x = 1;");
	editor.destroy();
});

test("paste inline formatting markdown (TipTap + Lix)", async () => {
	const lix = await openLix();
	const fileId = "paste_inline_format";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/paste-inline-format.md",
			data: new TextEncoder().encode(""),
		})
		.execute();
	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});
	const input = "This has **bold**, _italic_, and `code`.";
	await handlePaste({
		editor,
		event: {
			preventDefault: () => {},
			clipboardData: {
				getData: (t: string) => (t === "text/plain" ? input : ""),
			},
		},
	});
	await new Promise((r) => setTimeout(r, 0));
	const fileAfter = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.selectAll()
		.executeTakeFirst();
	const mdAfter = new TextDecoder().decode(fileAfter?.data ?? new Uint8Array());
	expect(mdAfter).toBe(ensureTrailingNewline(input));
	editor.destroy();
});

/**
 * Why this matters
 *
 * - Rapid user input can trigger multiple editor updates in quick succession.
 * - Without serialized persistence, overlapping transactions can drop rows,
 *   drop or reorder persisted markdown paragraphs.
 * - This test simulates Enter + typing without awaits to assert our debounce/queue
 *   logic persists a consistent 3-paragraph document.
 */
test("rapid Enter/type coalescing persists 3 paragraphs", async () => {
	const lix = await openLix();
	const fileId = "rapid_enter_coalesce";

	// Seed with a single paragraph
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/rapid-enter.md",
			data: new TextEncoder().encode("Start"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Simulate rapid user actions with no awaits between Enter and typing
	const end = editor.state.doc.content.size;
	editor.commands.setTextSelection(end);
	// Enter (new paragraph), then type quickly
	{
		const ev = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
	}
	editor.commands.insertContent("Second ");

	// Enter again and type another paragraph
	editor.commands.setTextSelection(editor.state.doc.content.size);
	{
		const ev = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		editor.view.someProp("handleKeyDown", (f) => f(editor.view, ev));
	}
	editor.commands.insertContent("Third ");

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 3,
	);
	expect(paragraphTexts(markdown)).toEqual(["Start", "Second", "Third"]);

	editor.destroy();
});

test("delete removes the middle paragraph from persisted markdown", async () => {
	const lix = await openLix();
	const fileId = "delete_middle_cleanup";

	// Seed with three paragraphs
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/delete-cleanup.md",
			data: new TextEncoder().encode("Start\n\nSecond\n\nThird"),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	// Force a persistence round on initial content
	editor.commands.setContent(
		astToTiptapDoc(parseMarkdown("Start\n\nSecond\n\nThird")) as any,
	);

	// Replace document with only first and third paragraphs (simulate deletion)
	editor.commands.setContent(
		astToTiptapDoc(parseMarkdown("Start\n\nThird")) as any,
	);

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => paragraphTexts(value).length === 2,
	);
	expect(paragraphTexts(markdown)).toEqual(["Start", "Third"]);

	editor.destroy();
});

test("editing a long markdown document does not truncate content below the edit point", async () => {
	const lix = await openLix();
	const fileId = "long_markdown_mid_edit";
	const initial = buildLongMarkdownRepro();

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/long-markdown-mid-edit.md",
			data: new TextEncoder().encode(initial),
		})
		.execute();

	const editor: Editor = await createEditorFromFile({
		lix,
		fileId,
		persistDebounceMs: 0,
	});

	editor.commands.setTextSelection(positionAfterText(editor, "TARGET"));
	editor.commands.insertContent(" EXACT");
	const expected = serializeAst(parseMarkdown(initial)).replace(
		"TARGET paragraph.",
		"TARGET EXACT paragraph.",
	);

	const markdown = await waitForMarkdown(
		lix,
		fileId,
		(value) => value === expected,
	);
	expect(markdown).toBe(expected);

	await new Promise((resolve) => setTimeout(resolve, 50));
	const settledMarkdown = await readMarkdown(lix, fileId);
	expect(settledMarkdown).toBe(expected);

	editor.destroy();
});
