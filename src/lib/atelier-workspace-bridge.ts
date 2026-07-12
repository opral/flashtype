import type { AtelierDocumentsApi } from "@opral/atelier";
import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { readCurrentAtelierDocumentPath } from "./atelier-document-state";

type DesktopWorkspaceBridge = Pick<
	NonNullable<Window["flashtypeDesktop"]>["workspace"],
	| "consumePendingOpenFiles"
	| "getMostRecentMarkdownFile"
	| "onCloseFile"
	| "onNewFile"
>;

type ConnectAtelierWorkspaceOptions = {
	readonly documents: AtelierDocumentsApi;
	readonly lix: Lix;
	readonly workspace: DesktopWorkspaceBridge;
	readonly onError?: (error: unknown) => void;
	readonly openWorkspacePath?: (path: string) => Promise<void>;
};

export type AtelierWorkspaceConnection = {
	readonly ready: Promise<void>;
	readonly dispose: () => void;
};

/**
 * Connects host-owned Electron document commands to one Atelier instance.
 * Startup selection stays in FlashType because Finder requests, transient
 * filesystem importing, and disk modification times are desktop concerns.
 */
export function connectAtelierWorkspace(
	options: ConnectAtelierWorkspaceOptions,
): AtelierWorkspaceConnection {
	const abortController = new AbortController();
	const { documents, workspace } = options;
	const openWorkspacePath =
		options.openWorkspacePath ??
		((path: string) =>
			openAtelierWorkspacePath({ documents, lix: options.lix, path }));

	const reportError = (error: unknown) => {
		if (abortController.signal.aborted) return;
		if (options.onError) {
			options.onError(error);
			return;
		}
		console.warn("Failed to synchronize Atelier workspace state", error);
	};

	const unsubscribeNewFile = workspace.onNewFile(() => {
		void documents.startNew().catch(reportError);
	});
	const unsubscribeCloseFile = workspace.onCloseFile(() => {
		void documents.closeActive().catch(reportError);
	});

	const ready = (async () => {
		const pendingOpenFiles = await workspace.consumePendingOpenFiles();
		if (abortController.signal.aborted) return;
		if (pendingOpenFiles.length > 0) {
			// Atelier has one central document, but every explicit Finder/open-file
			// path must be imported so the Files view can reveal the whole launch set.
			for (const pendingPath of pendingOpenFiles.slice(1)) {
				await ensureAtelierWorkspacePath(options.lix, pendingPath);
			}
			if (!abortController.signal.aborted) {
				await openWorkspacePath(pendingOpenFiles[0]!);
			}
			return;
		}

		if (await readCurrentAtelierDocumentPath(options.lix)) return;
		const recent = await workspace.getMostRecentMarkdownFile();
		if (abortController.signal.aborted || !recent?.path) return;

		// The filesystem scan is asynchronous. Re-read the persisted source of
		// truth so a user open that landed meanwhile wins over the fallback.
		if (await readCurrentAtelierDocumentPath(options.lix)) return;
		if (!abortController.signal.aborted) {
			await openWorkspacePath(recent.path);
		}
	})().catch(reportError);

	return {
		ready,
		dispose: () => {
			if (abortController.signal.aborted) return;
			abortController.abort();
			unsubscribeNewFile();
			unsubscribeCloseFile();
		},
	};
}

/** Imports a lazy Electron filesystem entry, then opens it through Atelier. */
export async function openAtelierWorkspacePath(args: {
	readonly documents: Pick<AtelierDocumentsApi, "open">;
	readonly lix: Lix;
	readonly path: string;
}): Promise<void> {
	const path = normalizeWorkspacePath(args.path);
	await ensureAtelierWorkspacePath(args.lix, path);
	await args.documents.open(path);
}

async function ensureAtelierWorkspacePath(
	lix: Lix,
	path: string,
): Promise<void> {
	const normalizedPath = normalizeWorkspacePath(path);
	let file = await qb(lix)
		.selectFrom("lix_file")
		.select("id")
		.where("path", "=", normalizedPath)
		.executeTakeFirst();
	if (file?.id) return;

	await lix.importFilesystemPaths([normalizedPath.replace(/^\/+/, "")]);
	file = await qb(lix)
		.selectFrom("lix_file")
		.select("id")
		.where("path", "=", normalizedPath)
		.executeTakeFirst();
	if (!file?.id) {
		throw new Error(`Imported file id not found for '${normalizedPath}'.`);
	}
}

function normalizeWorkspacePath(path: string): string {
	const normalized = path.trim().replace(/\\/gu, "/").replace(/^\/+/, "");
	if (!normalized) throw new Error("Workspace file path must not be empty.");
	return `/${normalized}`;
}
