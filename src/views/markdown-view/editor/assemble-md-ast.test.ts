import { test, expect } from "vitest";
import { markdownPluginV2ArchiveBytes } from "@/test-utils/plugin-md-v2-archive";
import { openLix } from "@lix-js/sdk";
import { assembleMdAst } from "./assemble-md-ast";
import { insertMarkdownSchemas } from "../../../lib/insert-markdown-schemas";
import { qb } from "@lix-js/kysely";

test("assembleMdAst returns empty root when no state root exists", async () => {
	const lix = await openLix();
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });
	const ast = await assembleMdAst({ lix, fileId: "missing_file" });
	expect(ast).toEqual({ type: "root", children: [] });
});

test("assembleMdAst returns ordered children from state (seeded by plugin)", async () => {
	const lix = await openLix();
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	const fileId = "util_file_1";
	const markdown = "Hello";
	await qb(lix)
		.insertInto("lix_file")
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
