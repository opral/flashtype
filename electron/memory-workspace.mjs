import path from "node:path";
import {
	readFile,
	writeFile,
	mkdir,
	unlink,
	lstat,
	realpath,
} from "node:fs/promises";

const equal = (a, b) =>
	a === b || (a != null && b != null && Buffer.from(a).equals(Buffer.from(b)));

/** Disk files remain durable; only their Lix history lives in memory. */
export function createMemoryWorkspace(lix, root) {
	const baseline = new Map();
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
	}
	return {
		importPaths,
		flush,
		syncDiskToLix: () => importPaths([...baseline.keys()]),
	};
}
