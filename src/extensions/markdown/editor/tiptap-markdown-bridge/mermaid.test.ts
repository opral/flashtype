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

	return {
		renderMermaidDiagram: vi.fn(async (_source: string, container: HTMLElement) => {
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
		reset() {
			theme = "default";
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
