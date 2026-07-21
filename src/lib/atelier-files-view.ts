import type { AtelierFilesViewOptions } from "@opral/atelier";
import { qb } from "@/lib/lix-kysely";
import type { Lix } from "@/lib/lix-types";

/**
 * Feeds FlashType's transient-workspace filesystem watchers into atelier's
 * bundled Files view: un-imported disk files render as `source: "watched"`
 * entries and are imported into lix on first interaction (open/rename).
 *
 * Only ephemeral (transient) workspaces list watched files; persistent
 * workspaces import everything up front and must not pass these options.
 *
 * @example
 * createAtelier({ lix, filesView: createEphemeralFilesViewOptions(lix) });
 */
export function createEphemeralFilesViewOptions(
	lix: Lix,
): AtelierFilesViewOptions {
	return {
		watchEntries: ({ expandedDirectories, onChange }) => {
			const workspaceApi = window.flashtypeDesktop?.workspace;
			if (!workspaceApi?.setEphemeralWatchedDirectories) {
				return () => {};
			}
			const ownerId = `files-view:${Math.random().toString(36).slice(2)}`;
			let active = true;
			void workspaceApi
				.setEphemeralWatchedDirectories({
					ownerId,
					paths: [...expandedDirectories],
				})
				.then((entries) => {
					if (active) {
						onChange(
							entries.map((entry) => ({
								path: entry.path,
								kind: entry.kind,
							})),
						);
					}
				})
				.catch((error: unknown) => {
					if (active) {
						console.warn("Failed to list transient workspace files", error);
					}
				});
			const unsubscribeChanges =
				workspaceApi.onEphemeralWatchedFileTreeChanged?.((entries) => {
					if (active) {
						onChange(
							entries.map((entry) => ({
								path: entry.path,
								kind: entry.kind,
							})),
						);
					}
				});
			return () => {
				active = false;
				unsubscribeChanges?.();
				void workspaceApi.setEphemeralWatchedDirectories?.({
					ownerId,
					paths: [],
				});
			};
		},
		resolveFileForInteraction: async (path) => {
			let file = await qb(lix)
				.selectFrom("lix_file")
				.select("id")
				.where("path", "=", path)
				.executeTakeFirst();
			if (!file?.id) {
				await lix.importFilesystemPaths([path.replace(/^\/+/, "")]);
				file = await qb(lix)
					.selectFrom("lix_file")
					.select("id")
					.where("path", "=", path)
					.executeTakeFirst();
			}
			return file?.id ? { fileId: String(file.id) } : null;
		},
	};
}
