import { test, expect } from "vitest";
import { openLix } from "@lix-js/sdk";
import { assembleMdAst } from "./assemble-md-ast";
import { insertMarkdownSchemas } from "../../../lib/insert-markdown-schemas";
import markdownPluginV2Manifest from "../../../../lix/packages/plugin-md-v2/manifest.json";
import markdownPluginV2WasmRaw from "../../../../lix/target/wasm32-wasip2/release/plugin_md_v2.wasm?raw";
import { qb } from "@lix-js/kysely";

const markdownPluginV2WasmBytes = Uint8Array.from(
	markdownPluginV2WasmRaw,
	(char) => char.charCodeAt(0),
);

test("assembleMdAst returns empty root when no state root exists", async () => {
	const lix = await openLix();
	await lix.installPlugin({
		manifestJson: markdownPluginV2Manifest,
		wasmBytes: markdownPluginV2WasmBytes,
	});
	await insertMarkdownSchemas({ lix });
	const ast = await assembleMdAst({ lix, fileId: "missing_file" });
	expect(ast).toEqual({ type: "root", children: [] });
});

test("assembleMdAst returns ordered children from state (seeded by plugin)", async () => {
	const lix = await openLix();
	await lix.installPlugin({
		manifestJson: markdownPluginV2Manifest,
		wasmBytes: markdownPluginV2WasmBytes,
	});
	await insertMarkdownSchemas({ lix });

	const fileId = "util_file_1";
	const markdown = "Hello";
	await qb(lix)
		.insertInto("file")
		.values({
			id: fileId,
			path: "/util.md",
			data: new TextEncoder().encode(markdown),
		})
		.execute();

	const ast = await assembleMdAst({ lix, fileId });
	expect(ast?.type).toBe("root");
	const children = (ast as any)?.children || [];
	expect(Array.isArray(children)).toBe(true);
	const hasHello = children.some(
		(n: any) =>
			n?.type === "paragraph" &&
			Array.isArray(n.children) &&
			n.children.some((c: any) => c?.type === "text" && c?.value === "Hello"),
	);
	expect(hasHello).toBe(true);
});
