import { MARKDOWN_PLUGIN_KEY } from "@/lib/lix-plugin-keys";
import { MARKDOWN_V2_DOCUMENT_SCHEMA_KEY } from "@/lib/markdown-v2-schema";
import type { Lix } from "@lix-js/sdk";
import { qb, sql } from "@lix-js/kysely";

export type CheckpointFileChangeRow = {
	readonly file_id: string;
	readonly path: string;
	readonly added: number;
	readonly removed: number;
};

/**
 * Lists Markdown checkpoint changes grouped by file.
 *
 * Aggregates additions and removals for every file that participated in the
 * provided checkpoint. File paths are resolved from the live filesystem table
 * when available and fall back to historical descriptors or stable file ids.
 *
 * @example
 * const rows = await selectCheckpointFiles({
 *   lix,
 *   changeSetId: checkpointId,
 * }).execute();
 *
 * console.log(rows.map((row) => row.path));
 */
export function selectCheckpointFiles({
	lix,
	changeSetId,
}: {
	lix: Lix;
	changeSetId: string;
}) {
	const pathExpr = sql<string>`COALESCE(
		MAX(lix_file.path),
		lix_change_set_element.file_id
	)`;

	return qb(lix)
		.selectFrom("lix_change_set_element")
		.innerJoin("lix_change", "lix_change.id", "lix_change_set_element.change_id")
		.leftJoin("lix_file", "lix_file.id", "lix_change_set_element.file_id")
		.where("lix_change_set_element.change_set_id", "=", changeSetId)
		.where("lix_change.plugin_key", "=", MARKDOWN_PLUGIN_KEY)
		.where("lix_change.schema_key", "!=", MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)
		.groupBy(["lix_change_set_element.file_id"])
		.select((eb) => [
			eb.ref("lix_change_set_element.file_id").as("file_id"),
			pathExpr.as("path"),
			eb.fn
				.sum<number>(
					sql`CASE WHEN lix_change.snapshot_content IS NOT NULL THEN 1 ELSE 0 END`,
				)
				.as("added"),
			eb.fn
				.sum<number>(
					sql`CASE WHEN lix_change.snapshot_content IS NULL THEN 1 ELSE 0 END`,
				)
				.as("removed"),
		])
		.orderBy("path", "asc")
		.$castTo<CheckpointFileChangeRow>();
}
