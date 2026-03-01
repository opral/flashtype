import { MARKDOWN_PLUGIN_KEY } from "@/lib/lix-plugin-keys";
import { MARKDOWN_V2_DOCUMENT_SCHEMA_KEY } from "@/lib/markdown-v2-schema";
import type { Lix } from "@lix-js/sdk";
import { qb, sql } from "@lix-js/kysely";

// Files
export function selectFiles(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_file")
		.select(["id", "path"]) // minimal row for explorer
		.orderBy("path", "asc");
}

export type FilesystemEntryRow = {
	id: string;
	parent_id: string | null;
	path: string;
	display_name: string;
	kind: "directory" | "file";
	hidden: number | string | boolean | null;
};

/**
 * Unified filesystem listing containing both directories and files ordered by path.
 *
 * Each row represents either a directory (with `kind === "directory"`) or a file
 * (`kind === "file"`) and is shaped to make tree construction straightforward on
 * the client.
 */
export function selectFilesystemEntries(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_directory")
		.select((eb) => [
			eb.ref("lix_directory.id").as("id"),
			eb.ref("lix_directory.parent_id").as("parent_id"),
			eb.ref("lix_directory.path").as("path"),
			eb.ref("lix_directory.name").as("display_name"),
			sql<string>`'directory'`.as("kind"),
			eb.ref("lix_directory.hidden").as("hidden"),
		])
		.unionAll(
			qb(lix)
				.selectFrom("lix_file")
				.select((eb) => [
					eb.ref("lix_file.id").as("id"),
					eb.ref("lix_file.directory_id").as("parent_id"),
					eb.ref("lix_file.path").as("path"),
					sql<string>`CASE
						WHEN lix_file.extension IS NULL OR lix_file.extension = ''
							THEN lix_file.name
						ELSE lix_file.name || '.' || lix_file.extension
					END`.as("display_name"),
					sql<string>`'file'`.as("kind"),
					eb.ref("lix_file.hidden").as("hidden"),
				]),
		)
		.orderBy("path", "asc")
		.$castTo<FilesystemEntryRow>();
}

/**
 * Aggregated working diff counts for the active file.
 *
 * The query scopes the change-set elements to the version's current working commit
 * so that live observers reset when checkpoints promote a new commit. Markdown
 * root-order changes are excluded to avoid counting pure reorders.
 *
 * @example
 * const counts = await selectWorkingDiffCount(lix).executeTakeFirst();
 * console.log(counts?.total ?? 0);
 */
export function selectWorkingDiffCount(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_working_changes as diff")
		.innerJoin("lix_key_value_by_version as active_file", (join) =>
			join.onRef("active_file.value", "=", "diff.file_id"),
		)
		.where("active_file.key", "=", "flashtype_active_file_id")
		.where("active_file.lixcol_version_id", "=", "global")
		.where("diff.status", "!=", "unchanged")
		.where("diff.schema_key", "like", "markdown_v2_%")
		.where("diff.schema_key", "!=", MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)
		.select((eb) => [
			eb.fn.count<number>("diff.file_id").as("total"),
			eb.fn
				.sum<number>(
					sql`CASE WHEN diff.status IN ('added', 'modified') THEN 1 ELSE 0 END`,
				)
				.as("added"),
			eb.fn
				.sum<number>(sql`CASE WHEN diff.status = 'removed' THEN 1 ELSE 0 END`)
				.as("removed"),
		]);
}

/**
 * Selects checkpoint change sets for the active file with aggregated diff counts.
 *
 * Returns each checkpoint with:
 * - id: change_set id
 * - commit_id: the associated commit id
 * - checkpoint_created_at: timestamp when the checkpoint label was created
 * - added: count of changes with non-null snapshot_content (insert/update)
 * - removed: count of changes with null snapshot_content (delete)
 *
 * Notes:
 * - Scoped to the currently active file via key_value_by_version("flashtype_active_file_id").
 * - Counts include only Markdown plugin changes and exclude RootOrder schema (reorders).
 */
export function selectCheckpoints({ lix }: { lix: Lix }) {
	return qb(lix)
		.selectFrom("lix_commit")
		.innerJoin("lix_change_set", "lix_change_set.id", "lix_commit.change_set_id")
		.innerJoin("lix_entity_label as checkpoint_label", (join) =>
			join
				.onRef("checkpoint_label.entity_id", "=", "lix_commit.id")
				.on("checkpoint_label.schema_key", "=", "lix_commit")
				.on("checkpoint_label.file_id", "=", "lix"),
		)
		.innerJoin("lix_label", "lix_label.id", "checkpoint_label.label_id")
		.where("lix_label.name", "=", "checkpoint")
		.leftJoin(
			"lix_change_set_element",
			"lix_change_set_element.change_set_id",
			"lix_change_set.id",
		)
		.leftJoin("lix_change", "lix_change.id", "lix_change_set_element.change_id")
		.groupBy(["lix_change_set.id", "lix_commit.id", "checkpoint_label.lixcol_created_at"])
		.select((eb) => [
			eb.ref("lix_change_set.id").as("id"),
			eb.ref("lix_commit.id").as("commit_id"),
			eb.ref("checkpoint_label.lixcol_created_at").as("checkpoint_created_at"),
		])
		.select((eb) => [
			eb.fn
				.sum<number>(
					sql`CASE 
						WHEN lix_change.plugin_key = ${sql.lit(MARKDOWN_PLUGIN_KEY)}
						 AND lix_change.schema_key != ${sql.lit(MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)}
						 AND lix_change.snapshot_content IS NOT NULL
						THEN 1 ELSE 0 END`,
				)
				.as("added"),
			eb.fn
				.sum<number>(
					sql`CASE 
						WHEN lix_change.plugin_key = ${sql.lit(MARKDOWN_PLUGIN_KEY)}
						 AND lix_change.schema_key != ${sql.lit(MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)}
						 AND lix_change.snapshot_content IS NULL
						THEN 1 ELSE 0 END`,
				)
				.as("removed"),
		])
		.orderBy("checkpoint_created_at", "desc")
		.$castTo<{
			id: string;
			commit_id: string;
			checkpoint_created_at: string | null;
			added: number | null;
			removed: number | null;
		}>();
}

/**
 * Generic diff counter for a change set.
 *
 * - Counts only Markdown changes and excludes RootOrder schema.
 * - If `fileId` is provided, restricts to that file; otherwise counts across all files.
 * - Accepts a concrete changeSetId or a subquery that selects it.
 */
// Chainable base query for diffs within a change set.
// Applies default filters: Markdown plugin and excludes RootOrder schema.
// Callers can further chain .where(...), .select(...), etc.
/**
 * Computes diff counts for a specific checkpoint (change set).
 *
 * If `fileId` is not provided, the active file (key "flashtype_active_file_id") is used.
 * Counts include only Markdown plugin changes and exclude RootOrder schema.
 */
export function selectCheckpointDiffCounts({
	lix,
	changeSetId,
	fileId,
}: {
	lix: Lix;
	changeSetId: string;
	fileId?: string | null;
}) {
	let query = qb(lix)
		.selectFrom("lix_change_set_element")
		.leftJoin("lix_change", "lix_change.id", "lix_change_set_element.change_id")
		.where("lix_change_set_element.change_set_id", "=", changeSetId)
		.where("lix_change.plugin_key", "=", MARKDOWN_PLUGIN_KEY)
		.where("lix_change.schema_key", "!=", MARKDOWN_V2_DOCUMENT_SCHEMA_KEY);

	if (fileId) {
		query = query.where("lix_change_set_element.file_id", "=", fileId);
	} else {
		query = query
			.innerJoin("lix_key_value_by_version as active_file", (join) =>
				join.onRef("active_file.value", "=", "lix_change_set_element.file_id"),
			)
			.where("active_file.key", "=", "flashtype_active_file_id")
			.where("active_file.lixcol_version_id", "=", "global");
	}

	return query
		.select((eb) => [
			eb.fn.count<number>("lix_change.id").as("total"),
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
		.$castTo<{
			total: number | null;
			added: number | null;
			removed: number | null;
		}>();
}
