import type { Lix } from "@lix-js/sdk";
import { qb } from "@lix-js/kysely";

export async function upsertMarkdownFile(args: {
	lix: Lix;
	fileId: string;
	markdown: string;
	path?: string;
	metadata?: any;
	hidden?: boolean;
}): Promise<void> {
	const { lix, fileId, markdown, path, metadata, hidden } = args;
	const data = new TextEncoder().encode(markdown);

	const existing = await qb(lix)
		.selectFrom("file")
		.select(["id"])
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (existing) {
		await qb(lix)
			.updateTable("file")
			.set({ data })
			.where("id", "=", fileId)
			.execute();
	} else {
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await qb(lix)
			.insertInto("file")
			.values({
				id: fileId,
				path: path ?? `/${fileId}.md`,
				data,
				metadata: metadata ?? null,
				hidden: hidden,
			})
			.execute();
	}
}
