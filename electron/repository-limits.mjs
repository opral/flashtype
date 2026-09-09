import { lstat, opendir } from "node:fs/promises";
import path from "node:path";

export const MAX_REPOSITORY_BYTES = 1_000_000_000;

/** Inspect metadata only, stopping as soon as the size limit is exceeded. */
export async function inspectRepositorySize(root) {
	root = path.resolve(root);
	let fileCount = 0;
	let totalBytes = 0;
	const directories = [root];
	const result = (complete) => ({
		fileCount,
		totalBytes,
		complete,
		allowed: totalBytes <= MAX_REPOSITORY_BYTES,
		maxBytes: MAX_REPOSITORY_BYTES,
	});
	while (directories.length) {
		const directory = await opendir(directories.pop());
		for await (const entry of directory) {
			if (
				entry.name === ".git" ||
				(directory.path === root &&
					[".lix", ".lix_system"].includes(entry.name))
			)
				continue;
			const filename = path.join(directory.path, entry.name);
			const info = await lstat(filename);
			// Never follow links outside the selected folder or count special files.
			if (info.isDirectory()) directories.push(filename);
			else if (info.isFile()) {
				fileCount += 1;
				totalBytes += info.size;
				if (totalBytes > MAX_REPOSITORY_BYTES) return result(false);
			}
		}
	}
	return result(true);
}

export async function assertRepositorySize(root) {
	const size = await inspectRepositorySize(root);
	if (!size.allowed) {
		throw new Error(
			"Cannot initialize this folder: it exceeds the 1 GB total-size limit. " +
				"Open a smaller folder to save persistent history. Your files remain editable.",
		);
	}
	return size;
}
