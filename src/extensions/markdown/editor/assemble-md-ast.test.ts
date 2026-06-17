import { test, expect } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { assembleMdAst } from "./assemble-md-ast";
import { qb } from "@/lib/lix-kysely";

test("assembleMdAst returns empty root when file is missing", async () => {
	const lix = await openLix();
	const ast = await assembleMdAst({ lix, fileId: "missing_file" });
	expect(ast).toEqual({ type: "root", children: [] });
});

test("assembleMdAst parses markdown from lix_file.data", async () => {
	const lix = await openLix();

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
