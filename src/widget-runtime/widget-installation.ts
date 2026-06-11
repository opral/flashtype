import type { Lix } from "@/lib/lix-types";

const GLOBAL_BRANCH_ID = "global";
const WIDGETS_ROOT = "/.lix_system/app_data/flashtype/widgets";
const textEncoder = new TextEncoder();

function validateWidgetId(widgetId: string): string {
	const normalized = widgetId.trim();
	if (!normalized) {
		throw new Error("widgetId must be non-empty.");
	}
	if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
		throw new Error(
			"widgetId may only contain letters, numbers, underscores, and dashes.",
		);
	}
	return normalized;
}

function normalizeRelativePath(path: string): string {
	const normalized = path.trim().replace(/\\/g, "/");
	if (!normalized) {
		throw new Error("file path must be non-empty.");
	}
	if (normalized.startsWith("/")) {
		throw new Error("file path must be relative to the widget directory.");
	}
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length === 0) {
		throw new Error("file path must contain at least one segment.");
	}
	if (parts.some((part) => part === "." || part === "..")) {
		throw new Error("file path must not contain '.' or '..' segments.");
	}
	return parts.join("/");
}

function widgetRootPath(widgetId: string): string {
	return `${WIDGETS_ROOT}/${validateWidgetId(widgetId)}`;
}

function normalizeFileData(data: string | Uint8Array): Uint8Array {
	return typeof data === "string" ? textEncoder.encode(data) : data;
}

type InstallWidgetFromFilesArgs = {
	readonly widgetId: string;
	readonly files: ReadonlyArray<{
		readonly path: string;
		readonly data: string | Uint8Array;
	}>;
};

export async function installWidgetFromFiles(
	lix: Lix,
	args: InstallWidgetFromFilesArgs,
): Promise<void> {
	const widgetId = validateWidgetId(args.widgetId);
	if (args.files.length === 0) {
		throw new Error("files must include at least one file.");
	}
	const basePath = widgetRootPath(widgetId);

	await lix.transaction(async (tx) => {
		for (const file of args.files) {
			const relativePath = normalizeRelativePath(file.path);
			const fullPath = `${basePath}/${relativePath}`;
			await tx.execute(
				"DELETE FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path = ?",
				[GLOBAL_BRANCH_ID, fullPath],
			);
			await tx.execute(
				"INSERT INTO lix_file_by_branch (path, data, lixcol_branch_id, lixcol_global) VALUES (?, ?, ?, ?)",
				[fullPath, normalizeFileData(file.data), GLOBAL_BRANCH_ID, true],
			);
		}
	});
}

export async function uninstallWidget(
	lix: Lix,
	widgetId: string,
): Promise<void> {
	const basePath = widgetRootPath(widgetId);

	await lix.transaction(async (tx) => {
		await tx.execute(
			"DELETE FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path LIKE ?",
			[GLOBAL_BRANCH_ID, `${basePath}/%`],
		);
		await tx.execute(
			"DELETE FROM lix_directory_by_branch WHERE lixcol_branch_id = ? AND path = ?",
			[GLOBAL_BRANCH_ID, `${basePath}/`],
		);
	});
}
