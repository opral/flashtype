import { waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AtelierDocumentsApi } from "@opral/atelier";
import type { Lix, LixRuntimeQueryResult } from "@/lib/lix-types";
import {
	connectAtelierWorkspace,
	openAtelierWorkspacePath,
} from "./atelier-workspace-bridge";

describe("connectAtelierWorkspace", () => {
	test("opens requested launch files before considering the recent-file fallback", async () => {
		const harness = createHarness();
		harness.workspace.consumePendingOpenFiles.mockResolvedValue([
			"requested.md",
			"also-requested.md",
		]);
		const connection = connectAtelierWorkspace(harness.options);
		await connection.ready;

		expect(harness.openWorkspacePath).toHaveBeenCalledOnce();
		expect(harness.openWorkspacePath).toHaveBeenCalledWith("requested.md");
		expect(harness.importFilesystemPaths).toHaveBeenCalledWith([
			"also-requested.md",
		]);
		expect(harness.workspace.getMostRecentMarkdownFile).not.toHaveBeenCalled();
		connection.dispose();
	});

	test("keeps a valid persisted document instead of opening the most recent file", async () => {
		const harness = createHarness({ activeDocumentPath: "/restored.md" });
		const connection = connectAtelierWorkspace(harness.options);
		await connection.ready;

		expect(harness.openWorkspacePath).not.toHaveBeenCalled();
		expect(harness.workspace.getMostRecentMarkdownFile).not.toHaveBeenCalled();
		connection.dispose();
	});

	test("does not let a delayed recent-file fallback replace a manual open", async () => {
		let resolveRecent:
			| ((file: { readonly path: string } | null) => void)
			| undefined;
		const recentPromise = new Promise<{ readonly path: string } | null>(
			(resolve) => {
				resolveRecent = resolve;
			},
		);
		const harness = createHarness();
		harness.workspace.getMostRecentMarkdownFile.mockReturnValue(recentPromise);
		const connection = connectAtelierWorkspace(harness.options);
		await waitFor(() =>
			expect(
				harness.workspace.getMostRecentMarkdownFile,
			).toHaveBeenCalledOnce(),
		);

		harness.setActiveDocument("/manual.md");
		resolveRecent?.({ path: "/recent.md" });
		await connection.ready;

		expect(harness.openWorkspacePath).not.toHaveBeenCalled();
		connection.dispose();
	});

	test("opens the recent Markdown file for an empty workspace", async () => {
		const harness = createHarness();
		harness.workspace.getMostRecentMarkdownFile.mockResolvedValue({
			path: "/recent.md",
		});
		const connection = connectAtelierWorkspace(harness.options);
		await connection.ready;

		expect(harness.openWorkspacePath).toHaveBeenCalledWith("/recent.md");
		connection.dispose();
	});

	test("routes native new and close commands through Atelier", async () => {
		const harness = createHarness({ activeDocumentPath: "/active.md" });
		const connection = connectAtelierWorkspace(harness.options);
		await connection.ready;

		await harness.emitNewFile();
		await harness.emitCloseFile();

		expect(harness.documents.startNew).toHaveBeenCalledOnce();
		expect(harness.documents.closeActive).toHaveBeenCalledOnce();
		connection.dispose();
		expect(harness.unsubscribeNewFile).toHaveBeenCalledOnce();
		expect(harness.unsubscribeCloseFile).toHaveBeenCalledOnce();
	});

	test("imports a lazy filesystem path before opening the document", async () => {
		const harness = createHarness();

		await openAtelierWorkspacePath({
			documents: harness.documents,
			lix: harness.lix,
			path: "lazy.md",
		});

		expect(harness.importFilesystemPaths).toHaveBeenCalledWith(["lazy.md"]);
		expect(harness.documents.open).toHaveBeenCalledWith("/lazy.md");
	});
});

function createHarness(
	initial: { readonly activeDocumentPath?: string | null } = {},
) {
	let activeDocumentPath = initial.activeDocumentPath ?? null;
	const filesById = new Map<string, string>();
	const importFilesystemPaths = vi.fn(async (paths: readonly string[]) => {
		for (const path of paths) {
			filesById.set(`imported:${path}`, `/${path.replace(/^\/+/, "")}`);
		}
	});
	const lix = {
		importFilesystemPaths,
		execute: vi.fn(async (sql: string, params?: ReadonlyArray<unknown>) => {
			if (sql.includes("lix_key_value_by_branch")) {
				return activeDocumentPath
					? queryResult([uiState("active-file", activeDocumentPath)], ["value"])
					: queryResult([], ["value"]);
			}
			if (sql.includes("WHERE id =")) {
				const path = filesById.get(String(params?.[0]));
				return queryResult(path ? [path] : [], ["path"]);
			}
			if (sql.includes("from lix_file") && sql.includes("where path")) {
				const path = String(params?.[0]);
				const entry = [...filesById.entries()].find(
					([, candidatePath]) => candidatePath === path,
				);
				return queryResult(entry ? [entry[0]] : [], ["id"]);
			}
			throw new Error(`Unexpected query: ${sql}`);
		}),
	} as unknown as Lix;
	const setActiveDocument = (path: string | null) => {
		activeDocumentPath = path;
		if (path) filesById.set("active-file", path);
	};
	setActiveDocument(activeDocumentPath);

	const documents: AtelierDocumentsApi = {
		open: vi.fn(async () => {}),
		startNew: vi.fn(async () => {}),
		closeActive: vi.fn(async () => {}),
	};
	let newFileListener: (() => void) | undefined;
	let closeFileListener: (() => void) | undefined;
	const unsubscribeNewFile = vi.fn();
	const unsubscribeCloseFile = vi.fn();
	const workspace = {
		consumePendingOpenFiles: vi.fn(async () => [] as string[]),
		getMostRecentMarkdownFile: vi.fn(
			async () =>
				null as {
					readonly path: string;
				} | null,
		),
		onNewFile: vi.fn((listener: () => void) => {
			newFileListener = listener;
			return unsubscribeNewFile;
		}),
		onCloseFile: vi.fn((listener: () => void) => {
			closeFileListener = listener;
			return unsubscribeCloseFile;
		}),
	};
	const openWorkspacePath = vi.fn(async () => {});

	return {
		documents,
		lix,
		workspace,
		openWorkspacePath,
		importFilesystemPaths,
		unsubscribeNewFile,
		unsubscribeCloseFile,
		setActiveDocument,
		async emitNewFile() {
			await newFileListener?.();
		},
		async emitCloseFile() {
			await closeFileListener?.();
		},
		options: {
			documents,
			lix,
			workspace: workspace as unknown as NonNullable<
				Window["flashtypeDesktop"]
			>["workspace"],
			openWorkspacePath,
		},
	};
}

function uiState(fileId: string, filePath: string) {
	return {
		panels: {
			central: {
				activeInstance: `atelier_file:${fileId}`,
				views: [
					{
						instance: `atelier_file:${fileId}`,
						kind: "atelier_file",
						state: { fileId, filePath },
					},
				],
			},
		},
	};
}

function queryResult(
	row: readonly unknown[],
	columns: readonly string[],
): LixRuntimeQueryResult {
	const values = Object.fromEntries(
		columns.map((column, index) => [column, row[index]]),
	);
	return {
		rows:
			row.length > 0
				? [
						{
							get: (column: string) => values[column],
							toObject: () => values,
						},
					]
				: [],
		columns: [...columns],
		rowsAffected: 0,
		notices: [],
	} as unknown as LixRuntimeQueryResult;
}
