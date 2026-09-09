import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export function createShareStore(directory, origin, encryption) {
	const root = path.join(
		directory,
		"sharing",
		createHash("sha256").update(origin).digest("hex"),
	);
	const authPath = path.join(root, "auth.enc");
	async function atomic(file, data) {
		await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const temp = `${file}.${randomUUID()}.tmp`;
		await writeFile(temp, data, { mode: 0o600 });
		await rename(temp, file);
	}
	const connectionPath = (workspace) =>
		path.join(
			root,
			createHash("sha256").update(path.resolve(workspace)).digest("hex"),
			"connection.json",
		);
	async function read(file) {
		try {
			return await readFile(file);
		} catch (error) {
			if (error.code === "ENOENT") return null;
			throw error;
		}
	}
	async function identity(workspace) {
		const info = await stat(path.join(workspace, ".lix"));
		return `${info.dev}:${info.ino}:${info.birthtimeMs}`;
	}
	return {
		async getAuth() {
			const data = await read(authPath);
			if (!data) return null;
			if (!encryption.isEncryptionAvailable())
				throw new Error("Secure credential storage is unavailable.");
			return JSON.parse(encryption.decryptString(data));
		},
		async setAuth(value) {
			if (
				!encryption.isEncryptionAvailable() ||
				encryption.getSelectedStorageBackend?.() === "basic_text"
			)
				throw new Error("Secure credential storage is unavailable.");
			await atomic(authPath, encryption.encryptString(JSON.stringify(value)));
		},
		async getConnection(workspace) {
			const bytes = await read(connectionPath(workspace));
			if (!bytes) return null;
			const connection = JSON.parse(bytes);
			if (connection.identity !== (await identity(workspace))) return null;
			return connection;
		},
		async saveConnection(workspace, connection) {
			await atomic(
				connectionPath(workspace),
				JSON.stringify({ ...connection, identity: await identity(workspace) }),
			);
		},
		snapshotPath(workspace) {
			return path.join(
				path.dirname(connectionPath(workspace)),
				"upload.lixsnap",
			);
		},
	};
}
