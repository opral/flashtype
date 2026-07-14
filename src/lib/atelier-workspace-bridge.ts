import type { AtelierDocumentsApi } from "@opral/atelier";
import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import {
	readAtelierDocumentSessionState,
	readCurrentAtelierDocumentPath,
} from "./atelier-document-state";

type DesktopWorkspaceBridge = Pick<
	NonNullable<Window["flashtypeDesktop"]>["workspace"],
	| "consumePendingOpenFiles"
	| "getMostRecentMarkdownFile"
	| "onCloseFile"
	| "onNewFile"
	| "setSessionOpenFilePaths"
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
	const uiStateEvents = options.lix.observe(
		`SELECT value
		 FROM lix_key_value_by_branch
		 WHERE key = $1
		   AND lixcol_branch_id = $2`,
		["atelier_ui_state", "global"],
	);
	const filePathEvents = options.lix.observe(
		`SELECT id, path
		 FROM lix_file
		 WHERE path NOT LIKE '/.lix/%'
		 ORDER BY id`,
	);
	let startupReady = false;
	let sessionPersistenceQueue = Promise.resolve();
	const persistSessionDocuments = () => {
		if (!startupReady || abortController.signal.aborted) return;
		sessionPersistenceQueue = sessionPersistenceQueue
			.catch(() => undefined)
			.then(async () => {
				if (abortController.signal.aborted) return;
				const state = await readAtelierDocumentSessionState(options.lix);
				if (abortController.signal.aborted) return;
				await workspace.setSessionOpenFilePaths({
					filePaths: state.openPaths.map((path) => path.replace(/^\/+/, "")),
				});
			})
			.catch(reportError);
	};
	const watchSessionEvents = async (
		events: ReturnType<Lix["observe"]>,
	): Promise<void> => {
		while (!abortController.signal.aborted) {
			const event = await events.next();
			if (!event || abortController.signal.aborted) return;
			persistSessionDocuments();
		}
	};
	void watchSessionEvents(uiStateEvents).catch(reportError);
	void watchSessionEvents(filePathEvents).catch(reportError);

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
	void ready.finally(() => {
		startupReady = true;
		persistSessionDocuments();
	});

	return {
		ready,
		dispose: () => {
			if (abortController.signal.aborted) return;
			abortController.abort();
			uiStateEvents.close();
			filePathEvents.close();
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
