import { readSharingJson, withRequestTimeout } from "./share-http.mjs";
import { createHash } from "node:crypto";
import { openLix } from "@lix-js/sdk";
import { mkdir, rename, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** A durable snapshot makes uncertain HTTP retries independent of ongoing edits. */
export function createShareService({
	runtime,
	getLix,
	fetcher = fetch,
	openRemote = openLix,
	waitForSync = () => new Promise((resolve) => setTimeout(resolve, 1000)),
}) {
	const pending = new Map();
	async function request(endpoint, init = {}) {
		const response = await withRequestTimeout(
			fetcher,
			endpoint === "/lix/v1" ? 600_000 : 10_000,
		)(new URL(endpoint, runtime.origin), {
			...init,
			headers: {
				...init.headers,
				Authorization: `Bearer ${await runtime.auth.token()}`,
			},
		});
		const body = await readSharingJson(response);
		if (!response.ok)
			throw new Error(
				typeof body.error === "string"
					? body.error
					: (body.error?.message ??
							"Lixray sharing is unavailable. Please try again."),
			);
		return body;
	}
	const connectionFor = async (workspace) => {
		const value = await runtime.store.getConnection(workspace.path);
		if (!value?.repository)
			throw new Error("Connect this repository to Lixray first.");
		if (new URL(value.repository.url).origin !== runtime.origin)
			throw new Error("Unexpected saved sync server.");
		if (value.accountId !== (await runtime.auth.subject()))
			throw new Error(
				"Paste a token for the Lixray account connected to this repository.",
			);
		return value;
	};
	return {
		async status(workspace, filePath) {
			const hasToken = await runtime.auth.hasToken();
			const connection = workspace.ephemeral
				? null
				: await runtime.store.getConnection(workspace.path);
			const mismatch =
				hasToken &&
				connection &&
				connection.accountId !== (await runtime.auth.subject());
			const error = mismatch
				? "Paste a token for the account that started sharing this repository."
				: runtime.errors.get(workspace.path);
			if (!hasToken || !connection?.repository || mismatch)
				return { hasToken, connected: Boolean(connection?.repository), error };
			const result = await request(
				`/api/repositories/${connection.repository.id}/share?path=${encodeURIComponent(filePath)}`,
			);
			return { ...result, hasToken, connected: true, error };
		},
		async connect(workspace, window) {
			if (workspace.ephemeral)
				throw new Error("Initialize this repository before sharing.");
			if (pending.has(workspace.path)) return pending.get(workspace.path);
			const operation = (async () => {
				const accountId = await runtime.auth.subject();
				let connection = await runtime.store.getConnection(workspace.path);
				if (connection && connection.accountId !== accountId)
					throw new Error(
						"Paste a token for the account that started sharing this repository.",
					);
				if (connection?.repository) return { reload: true };
				const snapshot = runtime.store.snapshotPath(workspace.path);
				if (!connection?.idempotencyKey) {
					await mkdir(path.dirname(snapshot), { recursive: true, mode: 0o700 });
					const staging = `${snapshot}.${randomUUID()}.tmp`;
					try {
						await (await getLix(window)).exportShareSnapshot(staging);
						await rename(staging, snapshot);
					} finally {
						await rm(staging, { force: true });
					}
					connection = { idempotencyKey: randomUUID(), accountId };
					await runtime.store.saveConnection(workspace.path, connection);
				}
				const repository = await request("/lix/v1", {
					method: "POST",
					headers: {
						"Content-Type": "application/vnd.lix.snapshot",
						"Idempotency-Key": connection.idempotencyKey,
					},
					body: createReadStream(snapshot),
					duplex: "half",
				});
				if (
					!/^[0-9a-f-]{36}$/.test(repository.id) ||
					repository.url !== `${runtime.origin}/lix/${repository.id}`
				)
					throw new Error("Lixray returned an invalid repository URL.");
				await runtime.store.saveConnection(workspace.path, {
					...connection,
					repository,
				});
				await rm(snapshot, { force: true });
				return { reload: true };
			})().finally(() => {
				pending.delete(workspace.path);
			});
			pending.set(workspace.path, operation);
			return operation;
		},
		async publish(workspace, window, filePath, publish) {
			const connection = await connectionFor(workspace);
			if (publish) {
				const lix = await getLix(window);
				const result = await lix.execute(
					"SELECT id, content FROM lix_file WHERE path = $1",
					[filePath],
				);
				if (!result.rows.length)
					throw new Error(
						"This file no longer exists. Open a file before sharing.",
					);
				if (runtime.errors.has(workspace.path))
					throw new Error("Reconnect sync from Share before publishing.");
				const remote = await openRemote({
					server: {
						url: connection.repository.url,
						fetch: withRequestTimeout(fetcher),
						headers: async () => ({
							Authorization: `Bearer ${await runtime.auth.token()}`,
						}),
					},
				});
				try {
					let found = false;
					for (let attempt = 0; attempt < 15; attempt++) {
						const current = await remote.execute(
							"SELECT id, content FROM lix_file WHERE path = $1",
							[filePath],
						);
						if (
							current.rows[0]?.id === result.rows[0]?.id &&
							fileContentHash(current.rows[0]?.content) ===
								fileContentHash(result.rows[0]?.content)
						) {
							found = true;
							break;
						}
						await waitForSync();
					}
					if (!found)
						throw new Error(
							"This file is still syncing. Wait a moment, then publish again.",
						);
				} finally {
					await remote.close();
				}
			}
			return request(
				`/api/repositories/${connection.repository.id}/share?path=${encodeURIComponent(filePath)}`,
				{ method: publish ? "POST" : "DELETE" },
			);
		},
	};
}

function fileContentHash(value) {
	if (!(value instanceof Uint8Array))
		throw new Error("The file content could not be read for sharing.");
	return createHash("sha256").update(value).digest("hex");
}
