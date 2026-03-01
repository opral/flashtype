import type { Lix } from "@lix-js/sdk";
import { qb } from "@lix-js/kysely";
import {
	MARKDOWN_V2_BLOCK_SCHEMA_KEY,
	MARKDOWN_V2_DOCUMENT_SCHEMA_KEY,
	MARKDOWN_V2_ROOT_ENTITY_ID,
	type MarkdownV2BlockSnapshot,
	type MarkdownV2DocumentSnapshot,
} from "@/lib/markdown-v2-schema";

function parseSnapshotContent<T>(value: unknown): T | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as T;
		} catch {
			return null;
		}
	}
	return value as T;
}

export async function assembleMdAst(args: {
	lix: Lix;
	fileId: string | null | undefined;
}): Promise<any> {
	const { lix, fileId } = args;
	if (!fileId) return { type: "root", children: [] };

	const root = await qb(lix)
		.selectFrom("lix_state")
		.where("file_id", "=", fileId)
		.where("schema_key", "=", MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)
		.where("entity_id", "=", MARKDOWN_V2_ROOT_ENTITY_ID)
		.select(["snapshot_content"])
		.executeTakeFirst();

	const documentSnapshot = parseSnapshotContent<MarkdownV2DocumentSnapshot>(
		root?.snapshot_content ?? null,
	);
	const order: string[] = Array.isArray(documentSnapshot?.order)
		? documentSnapshot.order
		: [];

	const nodes = await qb(lix)
		.selectFrom("lix_state")
		.where("file_id", "=", fileId)
		.where("schema_key", "=", MARKDOWN_V2_BLOCK_SCHEMA_KEY)
		.select(["entity_id", "snapshot_content"])
		.execute();

	const byId = new Map<string, MarkdownV2BlockSnapshot>();
	for (const row of nodes) {
		const snapshot = parseSnapshotContent<MarkdownV2BlockSnapshot>(
			row.snapshot_content,
		);
		if (!snapshot?.id || !snapshot?.node) {
			continue;
		}
		byId.set(snapshot.id, snapshot);
	}

	const children: any[] = [];
	for (const id of order) {
		const block = byId.get(id);
		if (block?.node) {
			children.push(block.node);
		}
	}

	if (children.length < byId.size) {
		const orderedIds = new Set(order);
		for (const [id, block] of byId.entries()) {
			if (orderedIds.has(id)) {
				continue;
			}
			if (block.node) {
				children.push(block.node);
			}
		}
	}

	return { type: "root", children };
}
