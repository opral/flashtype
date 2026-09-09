import { fetchSync } from "./share-http.mjs";
import { app, safeStorage } from "electron";
import { createShareAuth } from "./share-auth.mjs";
import { createShareStore } from "./share-store.mjs";
let runtime;
export function getShareRuntime() {
	if (!runtime) {
		const origin =
			process.env.FLASHTYPE_DEV_RUNTIME === "1" &&
			process.env.FLASHTYPE_DEV_LIXRAY_ORIGIN
				? new URL(process.env.FLASHTYPE_DEV_LIXRAY_ORIGIN).origin
				: "https://lixray.com";
		const url = new URL(origin);
		if (
			url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["127.0.0.1", "localhost"].includes(url.hostname)
			)
		)
			throw new Error("Lixray requires HTTPS.");
		const store = createShareStore(
			app.getPath("userData"),
			origin,
			safeStorage,
		);
		runtime = {
			origin,
			store,
			auth: createShareAuth({
				store,
				origin,
			}),
			errors: new Map(),
		};
	}
	return runtime;
}
export async function getShareServer(workspace) {
	const runtime = getShareRuntime();
	try {
		const connection = await runtime.store.getConnection(workspace.path);
		if (!connection?.repository) return undefined;
		const url = new URL(connection.repository.url);
		if (url.origin !== runtime.origin)
			throw new Error("The saved sync server does not match Lixray.");
		if (connection.accountId !== (await runtime.auth.subject()))
			throw new Error(
				"Paste a token for the Lixray account connected to this repository.",
			);
		runtime.errors.delete(workspace.path);
		return {
			url: url.href,
			fetch: fetchSync,
			headers: async () => ({
				Authorization: `Bearer ${await runtime.auth.token()}`,
			}),
		};
	} catch (error) {
		runtime.errors.set(workspace.path, error.message);
		return undefined;
	}
}
