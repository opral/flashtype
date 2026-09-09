// @vitest-environment node
import { test, expect } from "vitest";
import { mkdtemp, mkdir, rm, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createShareStore } from "./share-store.mjs";

test("credentials are encrypted and replaced repositories do not inherit sync", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "share-store-"));
	const workspace = path.join(dir, "workspace");
	await mkdir(path.join(workspace, ".lix"), { recursive: true });
	const encryption = {
		isEncryptionAvailable: () => true,
		encryptString: (text) => Buffer.from(Buffer.from(text).toString("base64")),
		decryptString: (bytes) =>
			Buffer.from(bytes.toString(), "base64").toString(),
	};
	try {
		const store = createShareStore(dir, "https://lixray.test", encryption);
		await store.setAuth({ tokens: { access_token: "secret-token" } });
		expect(await store.getAuth()).toEqual({
			tokens: { access_token: "secret-token" },
		});
		const [host] = await readdir(path.join(dir, "sharing"));
		expect(
			(await readFile(path.join(dir, "sharing", host, "auth.enc"))).toString(),
		).not.toContain("secret-token");
		await store.saveConnection(workspace, { repository: { id: "original" } });
		expect((await store.getConnection(workspace)).repository.id).toBe(
			"original",
		);
		await rm(path.join(workspace, ".lix"), { recursive: true });
		await mkdir(path.join(workspace, ".lix"));
		expect(await store.getConnection(workspace)).toBeNull();
		const insecure = createShareStore(dir, "https://other.test", {
			...encryption,
			isEncryptionAvailable: () => false,
		});
		await expect(insecure.setAuth({ token: "secret" })).rejects.toThrow(
			"Secure credential storage",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
