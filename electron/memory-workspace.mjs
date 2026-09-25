import path from "node:path";
import {
	readFile,
	writeFile,
	mkdir,
	rmdir,
	unlink,
	lstat,
	realpath,
} from "node:fs/promises";

const equal = (a, b) =>
	a === b || (a != null && b != null && Buffer.from(a).equals(Buffer.from(b)));

/** Disk files remain durable; only their Lix history lives in memory. */
export function createMemoryWorkspace(lix, root) {
	const baseline = new Map();
	const createdDirectories = new Set();
	async function diskPath(relative) {
		const parts = relative.replace(/^\/+/, "").split("/");
		if (
			parts.some(
				(part) => !part || part === "." || part === ".." || part === ".lix",
			) ||
			relative.includes("\\")
		)
			throw new Error("Invalid workspace path");
		const base = await realpath(root);
		let current = base;
		for (const part of parts) {
			current = path.join(current, part);
			try {
				if ((await lstat(current)).isSymbolicLink())
					throw new Error(
						"Symbolic links are not supported for in-memory workspace files",
					);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		return current;
	}
	async function read(relative) {
		try {
			return new Uint8Array(await readFile(await diskPath(relative)));
		} catch (error) {
			if (error.code === "ENOENT") return null;
			throw error;
		}
	}
	async function importPaths(paths) {
		for (const relative of paths) {
			const key = "/" + relative.replace(/^\/+/, "");
			const data = await read(key);
			if (equal(data, baseline.get(key))) continue;
			if (data === null)
				await lix.execute("DELETE FROM lix_file WHERE path = $1", [key]);
			else
				await lix.execute(
					"INSERT INTO lix_file (path, content) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET content = excluded.content",
					[key, data],
				);
			baseline.set(key, data);
		}
	}
	async function flush() {
		const directoryResult = await lix.execute(
			"SELECT path FROM lix_directory WHERE path != '/' AND path NOT LIKE '/.lix%'",
		);
		const directories = new Set(
			directoryResult.rows
				.map((row) => row.path)
				.filter((directoryPath) => typeof directoryPath === "string")
				.map(normalizeDirectoryPath),
		);
		for (const directoryPath of [...directories].sort(compareWorkspacePaths)) {
			await ensureDirectory(directoryPath);
		}

		const result = await lix.execute(
			"SELECT path, content FROM lix_file WHERE path NOT LIKE '/.lix/%'",
		);
		const files = new Map(
			result.rows
				.filter((row) => !row.path.endsWith("/"))
				.map((row) => [row.path, row.content]),
		);
		for (const key of new Set([...baseline.keys(), ...files.keys()])) {
			const previous = baseline.get(key) ?? null;
			const next = files.get(key) ?? null;
			if (equal(previous, next)) continue;
			const disk = await read(key);
			if (!equal(disk, previous) && !equal(disk, next))
				throw new Error(
					`File changed on disk while editing: ${key}. Reload before saving.`,
				);
			if (!equal(disk, next)) {
				const target = await diskPath(key);
				if (next === null) await unlink(target);
				else {
					await mkdir(path.dirname(target), { recursive: true });
					await writeFile(target, next);
				}
			}
			baseline.set(key, next);
		}

		for (const directoryPath of [...createdDirectories].sort(
			compareWorkspacePathsDescending,
		)) {
			if (directories.has(directoryPath)) continue;
			const target = await diskPath(directoryPath);
			try {
				await rmdir(target);
				createdDirectories.delete(directoryPath);
			} catch (error) {
				if (error.code === "ENOENT") {
					createdDirectories.delete(directoryPath);
					continue;
				}
				if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") {
					throw error;
				}
			}
		}
	}
	async function ensureDirectory(relative) {
		const target = await diskPath(relative);
		const base = await realpath(root);
		const parts = relative.replace(/^\/+/, "").split("/");
		let current = base;
		for (let index = 0; index < parts.length; index += 1) {
			current = path.join(current, parts[index]);
			try {
				const metadata = await lstat(current);
				if (metadata.isSymbolicLink()) {
					throw new Error(
						"Symbolic links are not supported for in-memory workspace files",
					);
				}
				if (!metadata.isDirectory()) {
					throw new Error(
						`Workspace directory path is not a directory: ${relative}`,
					);
				}
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				try {
					await mkdir(current);
					createdDirectories.add(`/${parts.slice(0, index + 1).join("/")}`);
				} catch (mkdirError) {
					if (mkdirError.code !== "EEXIST") throw mkdirError;
					const metadata = await lstat(current);
					if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
						throw new Error(
							`Workspace directory path is not a directory: ${relative}`,
						);
					}
				}
			}
		}
		return target;
	}
	return {
		importPaths,
		flush,
		syncDiskToLix: () => importPaths([...baseline.keys()]),
	};
}

function normalizeDirectoryPath(directoryPath) {
	return directoryPath.endsWith("/") && directoryPath !== "/"
		? directoryPath.slice(0, -1)
		: directoryPath;
}

function compareWorkspacePaths(left, right) {
	return (
		left.split("/").length - right.split("/").length ||
		left.localeCompare(right)
	);
}

function compareWorkspacePathsDescending(left, right) {
	return compareWorkspacePaths(right, left);
}
