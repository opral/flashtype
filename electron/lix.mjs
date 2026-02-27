import { app } from "electron";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { openLix } from "@lix-js/sdk";
import { createBetterSqlite3Backend } from "@lix-js/better-sqlite3-backend";

let lixPromise = null;

function getLixFilename() {
	return path.join(app.getPath("documents"), "lix", "main.lix");
}

function getLixStoragePaths() {
	const filename = getLixFilename();
	return [filename, `${filename}-wal`, `${filename}-shm`, `${filename}-journal`];
}

export async function ensureLixOpen() {
	if (!lixPromise) {
		lixPromise = (async () => {
			const filename = getLixFilename();
			await mkdir(path.dirname(filename), { recursive: true });
			const backend = await createBetterSqlite3Backend({ filename });
			return await openLix({ backend });
		})();
	}
	return await lixPromise;
}

export async function closeLix() {
	if (!lixPromise) {
		return;
	}
	const currentPromise = lixPromise;
	lixPromise = null;
	const lix = await currentPromise;
	await lix.close();
}

export async function wipeLixStorage() {
	await closeLix();
	for (const pathToDelete of getLixStoragePaths()) {
		await rm(pathToDelete, { force: true });
	}
}
