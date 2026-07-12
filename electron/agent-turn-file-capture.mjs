import { lstat, opendir } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set([
	".git",
	".lix",
	".lix_system",
	"node_modules",
]);

/**
 * Captures reviewable Markdown paths around one agent turn without reading file
 * contents. FlashType imports the baseline paths before the start commit, then
 * imports only paths whose filesystem metadata changed before the stop commit.
 */
export async function createAgentTurnFileCapture(workspacePath) {
	const rootPath = path.resolve(workspacePath);
	const baseline = await scanReviewableMarkdownFiles(rootPath);
	let closed = false;
	return {
		baselinePaths: [...baseline.keys()],
		async finish() {
			if (closed) return [];
			closed = true;
			const current = await scanReviewableMarkdownFiles(rootPath);
			const changedPaths = [...current.entries()]
				.filter(([filePath, fingerprint]) => {
					return baseline.get(filePath) !== fingerprint;
				})
				.map(([filePath]) => filePath);
			const deletedPaths = [...baseline.keys()].filter(
				(filePath) => !current.has(filePath),
			);
			return [...changedPaths, ...deletedPaths];
		},
		dispose() {
			closed = true;
		},
	};
}

async function scanReviewableMarkdownFiles(rootPath) {
	const files = new Map();
	await scanDirectory(rootPath, rootPath, files);
	return new Map(
		[...files].sort(([left], [right]) => left.localeCompare(right)),
	);
}

async function scanDirectory(rootPath, directoryPath, files) {
	let directory;
	try {
		directory = await opendir(directoryPath);
	} catch {
		return;
	}
	for await (const entry of directory) {
		if (entry.isSymbolicLink() || isIgnoredDirectoryName(entry.name)) continue;
		const localPath = path.join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			await scanDirectory(rootPath, localPath, files);
			continue;
		}
		if (!entry.isFile() || !/\.(?:md|markdown)$/iu.test(entry.name)) continue;
		let metadata;
		try {
			metadata = await lstat(localPath);
		} catch {
			continue;
		}
		if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
		const relativePath = normalizeRelativePath(
			path.relative(rootPath, localPath),
		);
		if (!relativePath) continue;
		files.set(
			relativePath,
			`${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`,
		);
	}
}

function normalizeRelativePath(value) {
	const normalized = String(value)
		.replace(/\\/gu, "/")
		.replace(/^\.\//u, "")
		.replace(/^\/+/, "");
	if (!normalized || normalized === ".") return null;
	const segments = normalized.split("/").filter(Boolean);
	if (segments.some((segment) => segment === "..")) return null;
	return segments.join("/");
}

function isIgnoredDirectoryName(name) {
	return name.startsWith(".") || IGNORED_DIRECTORY_NAMES.has(name);
}
