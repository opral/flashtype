import type { Lix } from "@/lib/lix-types";
import { qb, sql } from "@/lib/lix-kysely";

export type FilesystemEntryRow = {
	id: string;
	parent_id: string | null;
	path: string;
	display_name: string;
	kind: "directory" | "file";
	source?: "lix" | "watched";
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
			sql<string>`'lix'`.as("source"),
		])
		.unionAll(
			qb(lix)
				.selectFrom("lix_file")
				.select((eb) => [
					eb.ref("lix_file.id").as("id"),
					eb.ref("lix_file.directory_id").as("parent_id"),
					eb.ref("lix_file.path").as("path"),
					eb.ref("lix_file.name").as("display_name"),
					sql<string>`'file'`.as("kind"),
					sql<string>`'lix'`.as("source"),
				]),
		)
		.orderBy("path", "asc")
		.$castTo<FilesystemEntryRow>();
}
