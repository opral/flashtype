// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";

const __editors: Editor[] = [];
function createEditor(content?: any) {
	const ed = new Editor({
		extensions: MarkdownWc(),
		content,
	});
	__editors.push(ed);
	return ed;
}

afterEach(() => {
	// Ensure all editors are destroyed to stop ProseMirror DOM observers
	for (const ed of __editors.splice(0)) {
		try {
			ed.destroy();
		} catch {}
	}
});

// Simulate real text input so input rules trigger
function typeText(editor: Editor, text: string) {
	for (const ch of text) {
		const { from, to } = editor.state.selection;
		let handled = false;
		editor.view.someProp("handleTextInput", (f: any) => {
			handled = f(editor.view, from, to, ch) || handled;
		});
		if (!handled) {
			// Fallback: insert as plain content if no handler consumed it
			editor.commands.insertContent(ch);
		}
	}
}

function sendModKey(editor: Editor, key: string, opts?: { shift?: boolean }) {
	const tryPress = (flags: {
		metaKey: boolean;
		ctrlKey: boolean;
		shiftKey?: boolean;
	}) => {
		const event = new KeyboardEvent("keydown", {
			key,
			metaKey: flags.metaKey,
			ctrlKey: flags.ctrlKey,
			shiftKey: !!flags.shiftKey,
			bubbles: true,
			cancelable: true,
		});
		let handled = false;
		editor.view.someProp("handleKeyDown", (f: any) => {
			handled = f(editor.view, event) || handled;
		});
		return handled;
	};
	// Try meta-only first (mac style), then ctrl-only (windows/linux)
	if (tryPress({ metaKey: true, ctrlKey: false, shiftKey: opts?.shift }))
		return true;
	return tryPress({ metaKey: false, ctrlKey: true, shiftKey: opts?.shift });
}

function sendKey(editor: Editor, key: string, opts?: { shift?: boolean }) {
	const event = new KeyboardEvent("keydown", {
		key,
		shiftKey: !!opts?.shift,
		bubbles: true,
		cancelable: true,
	});
	editor.view.someProp("handleKeyDown", (f: any) => f(editor.view, event));
}

function setCursorAfterText(editor: Editor, text: string) {
	let position: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (position != null) return false;
		if (!node.isText) return true;
		const value = node.text ?? "";
		const index = value.indexOf(text);
		if (index >= 0) {
			position = pos + index + text.length;
			return false;
		}
		return true;
	});
	if (position == null) {
		throw new Error(`Could not find text: ${text}`);
	}
	editor.commands.setTextSelection(position);
}

describe("Markdown typing shortcuts (input rules)", () => {
	test.each([
		["#", 1],
		["##", 2],
		["###", 3],
		["####", 4],
		["#####", 5],
		["######", 6],
	])("%s ␣ → heading level %s", (hashes, level) => {
		const editor = createEditor();
		typeText(editor, `${hashes} `);
		const node = editor.state.doc.child(0);
		expect(node.type.name).toBe("heading");
		expect((node as any).attrs.level).toBe(level);
	});

	test("- ␣ → bullet list", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		const list = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBeGreaterThan(0);
		expect(list.child(0).type.name).toBe("listItem");
	});

	test("3. ␣ → ordered list start=3", () => {
		const editor = createEditor();
		typeText(editor, "3. ");
		const list = editor.state.doc.child(0);
		expect(list.type.name).toBe("orderedList");
		expect((list as any).attrs.start).toBe(3);
	});

	test("> ␣ → blockquote", () => {
		const editor = createEditor();
		typeText(editor, "> ");
		const node = editor.state.doc.child(0);
		expect(node.type.name).toBe("blockquote");
	});

	test.each([
		["[] ", false],
		["[ ] ", false],
		["[x] ", true],
	])("%s → task list item (checked=%s)", (trigger, checked) => {
		const editor = createEditor();
		// Support creating task from a plain paragraph
		typeText(editor, trigger as string);
		const list = editor.state.doc.child(0) as any;
		expect(list.type.name).toBe("bulletList");
		const li = list.child(0) as any;
		expect(li.type.name).toBe("listItem");
		expect(!!li.attrs?.checked).toBe(checked);
		// Should not retain trigger text
		const para = li.child(0) as any;
		expect((para.textContent || "").trim()).toBe("");
	});

	test.each([
		["- [] todo", "- [ ] todo\n", false],
		["- [ ] todo", "- [ ] todo\n", false],
		["- [x] done", "- [x] done\n", true],
	])("%s serializes as task-list markdown", (typed, markdown, checked) => {
		const editor = createEditor();
		typeText(editor, typed as string);
		const list = editor.state.doc.child(0) as any;
		const item = list.child(0) as any;

		expect(list.type.name).toBe("bulletList");
		expect(item.attrs?.checked).toBe(checked);
		expect(buildMarkdownFromEditor(editor)).toBe(markdown);
	});

	test("- [] serializes as a blank unchecked task item", () => {
		const editor = createEditor();
		typeText(editor, "- [] ");
		const list = editor.state.doc.child(0) as any;
		const item = list.child(0) as any;

		expect(item.attrs?.checked).toBe(false);
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] \n");
	});

	test("[ ] in a continuation paragraph stays literal text", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "first paragraph" }],
								},
								{
									type: "paragraph",
									content: [{ type: "text", text: "continuation" }],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "continuation");
		typeText(editor, "[ ] ");
		const item = editor.state.doc.child(0).child(0) as any;

		expect(item.attrs?.checked ?? null).toBeNull();
		expect(buildMarkdownFromEditor(editor)).toBe(
			"- first paragraph\n\n  continuation\\[ ]\n",
		);
	});
});

describe("Keyboard shortcuts (keymap)", () => {
	test("Mod-b toggles bold on selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("abc");
		editor.commands.setTextSelection({ from: 1, to: 4 });
		sendModKey(editor, "b");
		expect(editor.isActive("bold")).toBe(true);
	});

	test("Mod-i toggles italic on selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("abc");
		editor.commands.setTextSelection({ from: 1, to: 4 });
		sendModKey(editor, "i");
		expect(editor.isActive("italic")).toBe(true);
	});

	test("Shift-Mod-s toggles strike on selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("abc");
		editor.commands.setTextSelection({ from: 1, to: 4 });
		sendModKey(editor, "s", { shift: true });
		expect(editor.isActive("strike")).toBe(true);
	});

	test("Mod-Backspace deletes the previous word instead of the whole line", () => {
		const editor = createEditor();
		editor.commands.insertContent("alpha beta gamma");
		editor.commands.setTextSelection(editor.state.doc.content.size);
		sendModKey(editor, "Backspace");
		expect(buildMarkdownFromEditor(editor)).toBe("alpha beta\n");
	});

	test("Mod-Backspace at the start of a text block does not merge blocks", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "alpha" }] },
				{ type: "paragraph", content: [{ type: "text", text: "beta" }] },
			],
		});
		setCursorAfterText(editor, "beta");
		editor.commands.setTextSelection(
			editor.state.selection.from - "beta".length,
		);

		expect(sendModKey(editor, "Backspace")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("alpha\n\nbeta\n");
	});

	test("Mod-Backspace deletes the selection", () => {
		const editor = createEditor();
		editor.commands.insertContent("alpha beta gamma");
		setCursorAfterText(editor, "alpha ");
		const from = editor.state.selection.from;
		editor.commands.setTextSelection({ from, to: from + "beta".length });
		sendModKey(editor, "Backspace");
		expect(buildMarkdownFromEditor(editor)).toBe("alpha  gamma\n");
	});

	test("Shift-Enter inserts a hard break inside a paragraph", () => {
		const editor = createEditor();
		typeText(editor, "line");
		sendKey(editor, "Enter", { shift: true });
		typeText(editor, "break");

		const paragraph: any = editor.state.doc.child(0);
		expect(editor.state.doc.childCount).toBe(1);
		expect(paragraph.type.name).toBe("paragraph");
		expect(paragraph.childCount).toBe(3);
		expect(paragraph.child(0).type.name).toBe("text");
		expect(paragraph.child(0).text).toBe("line");
		expect(paragraph.child(1).type.name).toBe("hardBreak");
		expect(paragraph.child(2).type.name).toBe("text");
		expect(paragraph.child(2).text).toBe("break");
		expect(buildMarkdownFromEditor(editor)).toBe("line\\\nbreak\n");
	});

	test("Shift-Enter in a bullet list inserts a hard break without creating another item", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "line");
		sendKey(editor, "Enter", { shift: true });
		typeText(editor, "break");

		const list: any = editor.state.doc.child(0);
		const item: any = list.child(0);
		const paragraph: any = item.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(1);
		expect(item.type.name).toBe("listItem");
		expect(paragraph.childCount).toBe(3);
		expect(paragraph.child(1).type.name).toBe("hardBreak");
	});

	test("Enter in bullet list creates another bullet item", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		const list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(2);
		const li2: any = list.child(1);
		expect(li2.type.name).toBe("listItem");
		const para2: any = li2.child(0);
		expect((para2.textContent || "").trim()).toBe("");
	});

	test("Enter in ordered list creates another numbered item", () => {
		const editor = createEditor();
		typeText(editor, "1. ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		const list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("orderedList");
		expect(list.childCount).toBe(2);
	});

	test("Enter in todo list creates another unchecked todo", () => {
		const editor = createEditor();
		typeText(editor, "[] ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		const list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(2);
		const li2: any = list.child(1);
		expect(li2.type.name).toBe("listItem");
		expect(li2.attrs?.checked).toBe(false);
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] abc\n- [ ] \n");
	});

	test("Tab in bullet list indents the current item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
							],
						},
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "child" }],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "child");
		sendKey(editor, "Tab");

		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n  - child\n");
	});

	test("Shift-Tab in nested bullet list outdents the current item", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "child" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		setCursorAfterText(editor, "child");
		sendKey(editor, "Tab", { shift: true });

		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n- child\n");
		typeText(editor, " updated");
		expect(buildMarkdownFromEditor(editor)).toBe("- parent\n- child updated\n");
	});

	test("Enter on empty bullet list item exits the list", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		let list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		expect(list.childCount).toBe(2);
		// Now press Enter on empty item to exit
		sendKey(editor, "Enter");
		// Expect bullet list + following paragraph
		const root: any = editor.state.doc;
		expect(root.childCount).toBe(2);
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(1).type.name).toBe("paragraph");
	});

	test("Backspace on empty bullet list item removes the empty item", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.childCount).toBe(1);
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("- abc\n");
	});

	test("double Backspace after empty bullet list item keeps the list intact", () => {
		const editor = createEditor();
		typeText(editor, "- ");
		typeText(editor, "abc");
		sendKey(editor, "Enter");
		sendKey(editor, "Backspace");
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.childCount).toBe(1);
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("- abc\n");
	});

	test("Backspace on empty nested bullet removes it without flattening parent", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "Hello world" }],
								},
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [{ type: "paragraph" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		const docSize = editor.state.doc.content.size;
		editor.commands.setTextSelection(docSize - 3);
		sendKey(editor, "Backspace");
		sendKey(editor, "Backspace");

		expect(buildMarkdownFromEditor(editor)).toBe("- Hello world\n");
	});

	test("Backspace on empty list item with nested content keeps nested content", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{ type: "paragraph" },
								{
									type: "bulletList",
									content: [
										{
											type: "listItem",
											content: [
												{
													type: "paragraph",
													content: [{ type: "text", text: "child" }],
												},
											],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		editor.commands.setTextSelection(3);
		sendKey(editor, "Backspace");

		const root: any = editor.state.doc;
		const item = root.child(0).child(0);
		expect(item.childCount).toBe(2);
		expect(item.child(1).type.name).toBe("bulletList");
		expect(buildMarkdownFromEditor(editor)).toContain("child");
	});

	test("Enter on empty ordered list item exits the list", () => {
		const editor = createEditor();
		typeText(editor, "1. ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		let list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("orderedList");
		// Now press Enter on empty item to exit
		sendKey(editor, "Enter");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("orderedList");
		expect(root.child(1).type.name).toBe("paragraph");
	});

	test("Backspace on empty ordered list item removes the empty item", () => {
		const editor = createEditor();
		typeText(editor, "1. ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next item
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("orderedList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("1. abc\n");
	});

	test("Enter on empty todo item exits the list", () => {
		const editor = createEditor();
		typeText(editor, "[] ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next todo
		let list: any = editor.state.doc.child(0);
		expect(list.type.name).toBe("bulletList");
		// Now press Enter on empty todo to exit
		sendKey(editor, "Enter");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(1).type.name).toBe("paragraph");
	});

	test("Backspace on empty todo item removes the empty item", () => {
		const editor = createEditor();
		typeText(editor, "[] ");
		typeText(editor, "abc");
		sendKey(editor, "Enter"); // create empty next todo
		sendKey(editor, "Backspace");
		const root: any = editor.state.doc;
		expect(root.child(0).type.name).toBe("bulletList");
		expect(root.child(0).childCount).toBe(1);
		expect(buildMarkdownFromEditor(editor)).toBe("- [ ] abc\n");
	});

	// Why this matters: Top-level ids are used for persistence/threading. Pressing Enter
	// inside list items should not create/modify top-level ids beyond the list container.
	// This test ensures that editing within a list keeps the list's top-level id stable.
	test("Enter inside list items does not affect top-level root ids", () => {
		const editor = createEditor();
		// Create a bullet list with content
		typeText(editor, "- ");
		typeText(editor, "abc");

		const topLevelIds = () => {
			const doc: any = editor.getJSON();
			const content: any[] = (doc?.content ?? []) as any[];
			return content
				.filter((n) => n?.type === "bulletList")
				.map((n) => n?.attrs?.data?.id)
				.filter(Boolean);
		};

		// Trigger id assignment by creating the first list
		let before = topLevelIds();
		// If the id is not yet assigned, press Enter to force a transaction
		if (before.length === 0) {
			sendKey(editor, "Enter");
			before = topLevelIds();
		}
		expect(before.length).toBe(1);
		const listId = before[0];

		// Create another list item
		typeText(editor, "xyz");
		sendKey(editor, "Enter");
		const afterItem = topLevelIds();
		expect(afterItem.length).toBe(1);
		expect(afterItem[0]).toBe(listId);

		// Exit the list (Enter on empty item)
		sendKey(editor, "Enter");
		const afterExit = topLevelIds();
		expect(afterExit.length).toBe(1);
		expect(afterExit[0]).toBe(listId);
	});
});
