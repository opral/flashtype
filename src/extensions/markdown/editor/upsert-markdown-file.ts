import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { markFlashtypeMarkdownWrite } from "../external-write-tracking";

export async function upsertMarkdownFile(args: {
	lix: Lix;
	fileId: string;
	markdown: string;
	path?: string;
	metadata?: any;
}): Promise<void> {
	const { lix, fileId, markdown, path, metadata } = args;
	const data = new TextEncoder().encode(markdown);
	const db = qb(lix);
	markFlashtypeMarkdownWrite(fileId, markdown);

	const existing = await db
		.selectFrom("lix_file")
		.select(["id", "path", "lixcol_metadata"])
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (existing) {
		const resolvedPath = path ?? existing.path ?? `/${fileId}.md`;
		const resolvedMetadata = metadata ?? existing.lixcol_metadata ?? null;
		await db
			.updateTable("lix_file")
			.set({
				path: resolvedPath,
				data,
				lixcol_metadata: resolvedMetadata,
			})
			.where("id", "=", fileId)
			.execute();
	} else {
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await db
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: path ?? `/${fileId}.md`,
				data,
				lixcol_metadata: metadata ?? null,
			})
			.execute();
	}
}
