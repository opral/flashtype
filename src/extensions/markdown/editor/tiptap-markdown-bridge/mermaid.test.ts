// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { parseMarkdown, serializeAst } from "../markdown";
import { tiptapDocToAst } from "./tiptap-to-mdwc";

const mermaidMock = vi.hoisted(() => {
	let theme: "dark" | "default" = "default";
	const themeListeners = new Set<() => void>();
	let releaseInFlightRender: (() => void) | null = null;
	let deferNextRender = false;

	return {
		renderMermaidDiagram: vi.fn(async (_source: string, container: HTMLElement) => {
			if (deferNextRender) {
				deferNextRender = false;
				await new Promise<void>((resolve) => {
					releaseInFlightRender = resolve;
				});
				releaseInFlightRender = null;
			}
			const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
			container.replaceChildren(svg);
		}),
		resetMermaidForTests: vi.fn(),
		getMermaidRenderTheme: vi.fn(() => theme),
		onMermaidThemeChange: vi.fn((listener: () => void) => {
			themeListeners.add(listener);
			return () => {
				themeListeners.delete(listener);
			};
		}),
		setTheme(next: "dark" | "default") {
			theme = next;
			for (const listener of themeListeners) {
				listener();
			}
		},
		deferNextRenderOnce() {
			deferNextRender = true;
		},
		finishInFlightRender() {
			releaseInFlightRender?.();
		},
		reset() {
			theme = "default";
			deferNextRender = false;
			releaseInFlightRender = null;
			themeListeners.clear();
			mermaidMock.renderMermaidDiagram.mockClear();
		},
	};
});

vi.mock("./mermaid-render", () => mermaidMock);

const FLOWCHART = [
	"graph TD",
	"    A[Start] --> B{Done?}",
	"    B -->|Yes| C[End]",
].join("\n");

describe("mermaid code blocks", () => {
	test("parses mermaid fenced code blocks", () => {
		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);

		expect(ast.children[0]).toEqual({
			type: "code",
			lang: "mermaid",
			meta: null,
			value: FLOWCHART,
		});
	});

	test("roundtrips mermaid fenced code blocks", () => {
		const markdown = `\`\`\`mermaid\n${FLOWCHART}\n\`\`\`\n`;
		const ast = parseMarkdown(markdown);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		const output = serializeAst(tiptapDocToAst(editor.getJSON() as any));
		expect(output).toBe(markdown);
		editor.destroy();
	});

	test("shows a preview container when the editor is blurred", async () => {
		mermaidMock.reset();
		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		const block = editor.view.dom.querySelector(".markdown-mermaid-block");
		expect(block).not.toBeNull();
		expect(
			editor.view.dom.querySelector(".markdown-mermaid-preview"),
		).not.toBeNull();

		editor.commands.blur();
		expect(block?.getAttribute("data-editing")).toBe("false");

		await vi.waitFor(() => {
			expect(
				editor.view.dom.querySelector(".markdown-mermaid-preview svg"),
			).not.toBeNull();
		});

		editor.destroy();
	});

	test("hides preview from view and screen readers while editing", () => {
		mermaidMock.reset();
		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		(editor.view.dom as HTMLElement).focus();
		editor.commands.setTextSelection({ from: 1, to: 1 });
		const isFocusedSpy = vi.spyOn(editor, "isFocused", "get");
		isFocusedSpy.mockReturnValue(true);
		editor.emit("selectionUpdate", { editor, transaction: editor.state.tr });

		const block = editor.view.dom.querySelector(".markdown-mermaid-block");
		const preview = block?.querySelector(".markdown-mermaid-preview");

		expect(block?.getAttribute("data-editing")).toBe("true");
		expect(preview?.getAttribute("aria-hidden")).toBe("true");

		isFocusedSpy.mockReturnValue(false);
		editor.commands.blur();
		editor.emit("blur", { editor, event: new FocusEvent("blur") });
		expect(block?.getAttribute("data-editing")).toBe("false");
		expect(preview?.getAttribute("aria-hidden")).toBe("false");
		expect(
			block?.querySelector(".markdown-mermaid-sr-description")?.textContent,
		).toContain("graph TD");

		editor.destroy();
	});

	test("re-renders when theme changes during an in-flight render", async () => {
		mermaidMock.reset();
		mermaidMock.deferNextRenderOnce();

		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		editor.commands.blur();
		await vi.waitFor(() => {
			expect(mermaidMock.renderMermaidDiagram).toHaveBeenCalled();
		});
		const callsBeforeThemeChange =
			mermaidMock.renderMermaidDiagram.mock.calls.length;

		mermaidMock.setTheme("dark");
		mermaidMock.finishInFlightRender();
		await vi.waitFor(() => {
			expect(mermaidMock.renderMermaidDiagram.mock.calls.length).toBeGreaterThan(
				callsBeforeThemeChange,
			);
		});

		editor.destroy();
	});

	test("re-renders when the app theme changes", async () => {
		mermaidMock.reset();
		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		editor.commands.blur();
		await vi.waitFor(() => {
			expect(mermaidMock.renderMermaidDiagram).toHaveBeenCalledTimes(1);
		});

		mermaidMock.setTheme("dark");
		await vi.waitFor(() => {
			expect(mermaidMock.renderMermaidDiagram).toHaveBeenCalledTimes(2);
		});

		editor.destroy();
	});

	test("re-renders after a failed preview when the diagram source is unchanged", async () => {
		mermaidMock.reset();
		mermaidMock.renderMermaidDiagram
			.mockRejectedValueOnce(new Error("parse error"))
			.mockImplementation(async (_source: string, container: HTMLElement) => {
				const svg = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"svg",
				);
				container.replaceChildren(svg);
			});

		const ast = parseMarkdown(`\`\`\`mermaid\n${FLOWCHART}\n\`\`\``);
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		editor.commands.blur();
		await vi.waitFor(() => {
			expect(
				editor.view.dom.querySelector(".markdown-mermaid-error")?.textContent,
			).toContain("parse error");
		});

		mermaidMock.setTheme("dark");
		await vi.waitFor(() => {
			expect(
				editor.view.dom.querySelector(".markdown-mermaid-preview svg"),
			).not.toBeNull();
		});

		editor.destroy();
	});

	test("keeps non-mermaid code blocks as plain pre/code", () => {
		const ast = parseMarkdown("```js\nconst x = 1;\n```");
		const editor = new Editor({
			extensions: MarkdownWc(),
			content: astToTiptapDoc(ast),
		});

		expect(editor.view.dom.querySelector(".markdown-mermaid-block")).toBeNull();
		expect(editor.view.dom.querySelector("pre code.language-js")).not.toBeNull();

		editor.destroy();
	});
});
