// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { parseMarkdown, serializeAst } from "../markdown";
import { tiptapDocToAst } from "./tiptap-to-mdwc";

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

	test("shows a preview container when the editor is blurred", () => {
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
