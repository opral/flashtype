import { expect, test } from "vitest";
import {
	EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY,
	astToTiptapDoc,
} from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";

test("empty document defaults to a paragraph scaffold", () => {
	const pm = astToTiptapDoc({ type: "root", children: [] });

	expect(pm.content).toEqual([{ type: "paragraph", attrs: { data: {} } }]);
	expect(tiptapDocToAst(pm)).toEqual({ type: "root", children: [] });
});

test("empty document can default to a heading 1 scaffold", () => {
	const pm = astToTiptapDoc(
		{ type: "root", children: [] },
		{ defaultBlock: "heading1" },
	);

	expect(pm.content).toEqual([
		{
			type: "heading",
			attrs: {
				level: 1,
				data: { [EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY]: true },
			},
		},
	]);
	expect(tiptapDocToAst(pm)).toEqual({ type: "root", children: [] });
});

test("default heading scaffold marker is not persisted once content exists", () => {
	const pm = astToTiptapDoc(
		{ type: "root", children: [] },
		{ defaultBlock: "heading1" },
	);
	pm.content![0] = {
		...pm.content![0],
		content: [{ type: "text", text: "Document title" }],
	};

	expect(tiptapDocToAst(pm)).toEqual({
		type: "root",
		children: [
			{
				type: "heading",
				depth: 1,
				data: null,
				children: [{ type: "text", value: "Document title" }],
			},
		],
	});
});
