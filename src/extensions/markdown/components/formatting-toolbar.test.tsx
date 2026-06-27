import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import {
	MarkdownWc,
	astToTiptapDoc,
} from "@/extensions/markdown/editor/tiptap-markdown-bridge";
import { FormattingToolbar } from "./formatting-toolbar";
import { EditorProvider, useEditorCtx } from "../editor/editor-context";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import { parseMarkdown } from "../editor/markdown";

type EditorSetup = {
	editor: Editor;
	element: HTMLElement;
};

function createEditor(content: JSONContent): EditorSetup {
	const element = document.createElement("div");
	document.body.appendChild(element);

	const editor = new Editor({
		element,
		extensions: MarkdownWc() as any,
		content,
	});

	return { editor, element };
}

function destroyEditor({ editor, element }: EditorSetup) {
	editor.destroy();
	element.remove();
}

function InjectEditor({ editor }: { editor: Editor }) {
	const { setEditor } = useEditorCtx();

	useEffect(() => {
		setEditor(editor);
		return () => {
			setEditor(null);
		};
	}, [editor, setEditor]);

	return null;
}

function renderToolbar(editor: Editor) {
	return render(
		<EditorProvider>
			<InjectEditor editor={editor} />
			<FormattingToolbar />
		</EditorProvider>,
	);
}

function textSelection(editor: Editor, text: string) {
	let from: number | null = null;
	let to: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (from != null) return false;
		if (!node.isText) return true;
		const value = node.text ?? "";
		const index = value.indexOf(text);
		if (index >= 0) {
			from = pos + index;
			to = from + text.length;
			return false;
		}
		return true;
	});
	if (from == null || to == null) {
		throw new Error(`Could not find text selection: ${text}`);
	}
	return { from, to };
}

const paragraphDoc: JSONContent = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Hello world" }],
		},
	],
};

const bulletListDoc: JSONContent = {
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
							content: [{ type: "text", text: "First" }],
						},
					],
				},
			],
		},
	],
};

const newFileMarkdown =
	"# Launching\n\n- open source launch (reddit)\n- hello\n\n# Campaigns\n\n- github stars\n";
const mixedTaskListMarkdown = "- plain bullet\n- [ ] todo\n";

describe("FormattingToolbar", () => {
	const originalClipboard = navigator.clipboard;
	let writeTextMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		writeTextMock = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: writeTextMock },
			configurable: true,
		});
	});

	afterEach(() => {
		Object.defineProperty(navigator, "clipboard", {
			value: originalClipboard,
			configurable: true,
		});
	});

	test("renders stable analytics selectors for toolbar controls", async () => {
		const setup = createEditor(paragraphDoc);
		const utils = renderToolbar(setup.editor);

		const toolbar = await screen.findByRole("toolbar", {
			name: "Formatting toolbar",
		});

		expect(toolbar).toHaveAttribute("data-attr", "markdown-format-toolbar");
		expect(toolbar.querySelector("[data-attr='markdown-block-selector']")).toBe(
			screen.getByRole("combobox"),
		);
		expect(screen.getByLabelText("Bold")).toHaveAttribute(
			"data-attr",
			"markdown-format-bold",
		);
		expect(screen.getByLabelText("Italic")).toHaveAttribute(
			"data-attr",
			"markdown-format-italic",
		);
		expect(screen.getByLabelText("Inline code")).toHaveAttribute(
			"data-attr",
			"markdown-format-code",
		);
		expect(screen.getByLabelText("Numbered list")).toHaveAttribute(
			"data-attr",
			"markdown-format-ordered-list",
		);
		expect(screen.getByLabelText("Bullet list")).toHaveAttribute(
			"data-attr",
			"markdown-format-bullet-list",
		);
		expect(screen.getByLabelText("Checklist")).toHaveAttribute(
			"data-attr",
			"markdown-format-task-list",
		);
		expect(screen.getByLabelText("Copy markdown")).toHaveAttribute(
			"data-attr",
			"markdown-copy-markdown",
		);

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("applies bold formatting to the current selection", async () => {
		const setup = createEditor(paragraphDoc);
		const utils = renderToolbar(setup.editor);

		await screen.findByLabelText("Bold");

		await act(async () => {
			setup.editor.commands.setTextSelection({ from: 1, to: 6 });
			fireEvent.click(screen.getByLabelText("Bold"));
		});

		expect(setup.editor.isActive("bold")).toBe(true);

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("wraps the current block in a bullet list without unwrapping a collapsed list selection", async () => {
		const setup = createEditor(paragraphDoc);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");

		await act(async () => {
			setup.editor.commands.setTextSelection(
				textSelection(setup.editor, "Hello world"),
			);
			fireEvent.click(bulletButton);
		});

		expect(setup.editor.isActive("bulletList")).toBe(true);
		let doc = setup.editor.getJSON() as any;
		expect(doc.content?.[0]?.type).toBe("bulletList");

		await act(async () => {
			setup.editor.commands.setTextSelection({ from: 2, to: 2 });
			fireEvent.click(bulletButton);
		});

		expect(setup.editor.isActive("bulletList")).toBe(true);
		doc = setup.editor.getJSON() as any;
		expect(doc.content?.[0]?.type).toBe("bulletList");

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("unwraps an explicitly selected bullet-list item", async () => {
		const setup = createEditor(bulletListDoc);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");

		await act(async () => {
			setup.editor.commands.setTextSelection(
				textSelection(setup.editor, "First"),
			);
			fireEvent.click(bulletButton);
		});

		expect(setup.editor.isActive("bulletList")).toBe(false);
		const doc = setup.editor.getJSON() as any;
		expect(doc.content?.[0]?.type).toBe("paragraph");
		expect(buildMarkdownFromEditor(setup.editor)).toBe("First\n");

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("keeps the final single-item bullet list serialized after choosing the bullet-list control", async () => {
		const setup = createEditor(
			astToTiptapDoc(parseMarkdown(newFileMarkdown)) as JSONContent,
		);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");

		await act(async () => {
			setup.editor.commands.setTextSelection(
				setup.editor.state.doc.content.size,
			);
			fireEvent.click(bulletButton);
		});

		expect(buildMarkdownFromEditor(setup.editor)).toBe(newFileMarkdown);

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("toggles checklist state using the fallback implementation", async () => {
		const setup = createEditor(paragraphDoc);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");
		const checklistButton = await screen.findByLabelText("Checklist");

		await act(async () => {
			setup.editor.commands.selectAll();
			fireEvent.click(bulletButton);
		});

		await act(async () => {
			setup.editor.commands.setTextSelection({ from: 2, to: 2 });
			fireEvent.click(checklistButton);
		});

		let listItem = (setup.editor.getJSON() as any).content?.[0]?.content?.[0];
		expect(listItem?.attrs?.checked).toBe(false);
		expect(bulletButton).toHaveAttribute("aria-pressed", "false");
		expect(checklistButton).toHaveAttribute("aria-pressed", "true");

		await act(async () => {
			fireEvent.click(checklistButton);
		});

		listItem = (setup.editor.getJSON() as any).content?.[0]?.content?.[0];
		expect(listItem?.attrs?.checked ?? null).toBeNull();
		expect(bulletButton).toHaveAttribute("aria-pressed", "true");
		expect(checklistButton).toHaveAttribute("aria-pressed", "false");

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("converts a selected checklist item back to a plain bullet list", async () => {
		const setup = createEditor(
			astToTiptapDoc(parseMarkdown("- [ ] todo\n")) as JSONContent,
		);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");
		const checklistButton = await screen.findByLabelText("Checklist");

		await act(async () => {
			setup.editor.commands.setTextSelection({ from: 3, to: 3 });
			fireEvent.click(bulletButton);
		});

		const list = (setup.editor.getJSON() as any).content?.[0];
		const listItem = list?.content?.[0];
		expect(list?.attrs?.isTaskList).toBe(false);
		expect(listItem?.attrs?.checked ?? null).toBeNull();
		expect(buildMarkdownFromEditor(setup.editor)).toBe("- todo\n");
		expect(bulletButton).toHaveAttribute("aria-pressed", "true");
		expect(checklistButton).toHaveAttribute("aria-pressed", "false");

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("does not mutate parent list items when toggling an inner item", async () => {
		const setup = createEditor(
			astToTiptapDoc(parseMarkdown("- outer\n  - inner\n")) as JSONContent,
		);
		const utils = renderToolbar(setup.editor);

		const checklistButton = await screen.findByLabelText("Checklist");

		await act(async () => {
			const selection = textSelection(setup.editor, "inner");
			setup.editor.commands.setTextSelection({
				from: selection.from + 1,
				to: selection.from + 1,
			});
			fireEvent.click(checklistButton);
		});

		const outerList = (setup.editor.getJSON() as any).content?.[0];
		const outerItem = outerList?.content?.[0];
		const innerList = outerItem?.content?.[1];
		const innerItem = innerList?.content?.[0];
		expect(outerList?.attrs?.isTaskList).toBe(false);
		expect(outerItem?.attrs?.checked ?? null).toBeNull();
		expect(innerList?.attrs?.isTaskList).toBe(true);
		expect(innerItem?.attrs?.checked).toBe(false);
		expect(buildMarkdownFromEditor(setup.editor)).toBe(
			"- outer\n  - [ ] inner\n",
		);

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("shows plain bullets and checklist items separately in a mixed list", async () => {
		const setup = createEditor(
			astToTiptapDoc(parseMarkdown(mixedTaskListMarkdown)) as JSONContent,
		);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");
		const checklistButton = await screen.findByLabelText("Checklist");

		await act(async () => {
			setup.editor.commands.setTextSelection(
				textSelection(setup.editor, "plain bullet"),
			);
		});

		expect(bulletButton).toHaveAttribute("aria-pressed", "true");
		expect(checklistButton).toHaveAttribute("aria-pressed", "false");

		await act(async () => {
			setup.editor.commands.setTextSelection(
				textSelection(setup.editor, "todo"),
			);
		});

		expect(bulletButton).toHaveAttribute("aria-pressed", "false");
		expect(checklistButton).toHaveAttribute("aria-pressed", "true");

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("copies the current document as markdown", async () => {
		const setup = createEditor(paragraphDoc);
		const utils = renderToolbar(setup.editor);

		const copyButton = await screen.findByLabelText(/copy markdown/i);
		const expected = buildMarkdownFromEditor(setup.editor);

		await act(async () => {
			fireEvent.click(copyButton);
		});

		expect(writeTextMock).toHaveBeenCalledWith(expected);

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});

	test("reflects external content changes in the toolbar state", async () => {
		const setup = createEditor(bulletListDoc);
		const utils = renderToolbar(setup.editor);

		const bulletButton = await screen.findByLabelText("Bullet list");
		expect(bulletButton).toHaveAttribute("aria-pressed", "true");

		await act(async () => {
			setup.editor.commands.setContent(paragraphDoc);
		});

		expect(bulletButton).toHaveAttribute("aria-pressed", "false");

		await act(async () => {
			utils.unmount();
		});
		destroyEditor(setup);
	});
});
