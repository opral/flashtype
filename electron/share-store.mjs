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
	async function identity(workspace, create = false) {
		// Filesystems can reuse both an inode and its coarse creation timestamp.
		// Keep a local-only nonce under Lix's excluded internal directory instead.
		const lixDirectory = path.join(workspace, ".lix");
		const marker = path.join(lixDirectory, ".internal", "flashtype-share-id");
		let value = await read(marker);
		if (!value && create) {
			if (!(await stat(lixDirectory)).isDirectory())
				throw new Error("Repository is unavailable.");
			await mkdir(path.dirname(marker), { recursive: true, mode: 0o700 });
			try {
				await writeFile(marker, randomUUID(), { flag: "wx", mode: 0o600 });
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
			value = await read(marker);
		}
		const id = value?.toString();
		if (!id) {
			if (create)
				throw new Error("Repository sharing identity is unavailable.");
			return null;
		}
		if (
			!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
				id,
			)
		)
			throw new Error("Repository sharing identity is invalid.");
		return id;
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
			const currentIdentity = await identity(workspace);
			if (!currentIdentity || connection.identity !== currentIdentity)
				return null;
			return connection;
		},
		async saveConnection(workspace, connection) {
			await atomic(
				connectionPath(workspace),
				JSON.stringify({
					...connection,
					identity: await identity(workspace, true),
				}),
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
