import { generateHTML } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";

export function renderMarkdownAstEditorHtml(
	ast: any,
	options: { readonly resolveImageSrc?: (src: string) => string } = {},
): string {
	return generateHTML(astToTiptapDoc(ast) as any, [
		...(MarkdownWc({ resolveImageSrc: options.resolveImageSrc }) as any[]),
		History,
		Placeholder,
		SlashCommandsExtension.configure({ onStateChange: () => {} }),
		TableNavigationExtension,
	]);
}

export function ensureDiffIds(node: any, path: string = "0"): void {
	if (!node || typeof node !== "object") return;
	if (supportsDiffId(node)) {
		node.data = node.data && typeof node.data === "object" ? node.data : {};
		if (typeof node.data.id !== "string" || node.data.id.length === 0) {
			node.data.id = `diff_${path}`;
		}
	}
	const children = Array.isArray(node.children) ? node.children : [];
	children.forEach((child: any, index: number) => {
		ensureDiffIds(child, `${path}_${index}`);
	});
}

export function supportsDiffId(node: any): boolean {
	return [
		"paragraph",
		"heading",
		"list",
		"listItem",
		"blockquote",
		"code",
		"html",
		"yaml",
		"thematicBreak",
		"table",
		"tableRow",
		"tableCell",
		"break",
		"image",
	].includes(node.type);
}
