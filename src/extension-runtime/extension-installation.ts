import type { Lix } from "@/lib/lix-types";

const GLOBAL_BRANCH_ID = "global";
const EXTENSIONS_ROOT = "/.lix_system/app_data/flashtype/extensions";
const textEncoder = new TextEncoder();

function validateExtensionId(extensionId: string): string {
	const normalized = extensionId.trim();
	if (!normalized) {
		throw new Error("extensionId must be non-empty.");
	}
	if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
		throw new Error(
			"extensionId may only contain letters, numbers, underscores, and dashes.",
		);
	}
	return normalized;
}

function normalizeRelativePath(path: string): string {
	if (!path) {
		throw new Error("file path must be non-empty.");
	}
	if (path.startsWith("/") || path.startsWith("\\")) {
		throw new Error("file path must be relative to the extension directory.");
	}
	if (path.includes("\\")) {
		throw new Error("file path must use forward slash separators.");
	}
	const parts = path.split("/");
	if (parts.some((part) => part.length === 0)) {
		throw new Error("file path must not contain empty segments.");
	}
	if (parts.some((part) => part === "." || part === "..")) {
		throw new Error("file path must not contain '.' or '..' segments.");
	}
	return path;
}

function extensionRootPath(extensionId: string): string {
	return `${EXTENSIONS_ROOT}/${validateExtensionId(extensionId)}`;
}

function normalizeFileData(data: string | Uint8Array): Uint8Array {
	return typeof data === "string" ? textEncoder.encode(data) : data;
}

type InstallExtensionFromFilesArgs = {
	readonly extensionId: string;
	readonly files: ReadonlyArray<{
		readonly path: string;
		readonly data: string | Uint8Array;
	}>;
};

export async function installExtensionFromFiles(
	lix: Lix,
	args: InstallExtensionFromFilesArgs,
): Promise<void> {
	const extensionId = validateExtensionId(args.extensionId);
	if (args.files.length === 0) {
		throw new Error("files must include at least one file.");
	}
	const basePath = extensionRootPath(extensionId);

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

export async function uninstallExtension(
	lix: Lix,
	extensionId: string,
): Promise<void> {
	const basePath = extensionRootPath(extensionId);
	const filePrefix = `${basePath}/`;
	const filePrefixUpperBound = `${basePath}0`;

	await lix.transaction(async (tx) => {
		await tx.execute(
			"DELETE FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path >= ? AND path < ?",
			[GLOBAL_BRANCH_ID, filePrefix, filePrefixUpperBound],
		);
		await tx.execute(
			"DELETE FROM lix_directory_by_branch WHERE lixcol_branch_id = ? AND path = ?",
			[GLOBAL_BRANCH_ID, `${basePath}/`],
		);
	});
}
