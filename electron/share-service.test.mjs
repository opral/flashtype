// @vitest-environment node
import { test, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createShareService } from "./share-service.mjs";

test("creation retries reuse identical persisted bytes even after restart and source edits", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "share-retry-"));
	let connection,
		source = "original snapshot";
	const snapshot = path.join(root, "upload.lixsnap");
	const runtime = {
		origin: "https://lixray.test",
		auth: { token: async () => "token", subject: async () => "owner" },
		errors: new Map(),
		store: {
			getConnection: async () => connection,
			saveConnection: async (_path, value) => {
				connection = structuredClone(value);
			},
			snapshotPath: () => snapshot,
		},
	};
	const exported = vi.fn(async (destination) => {
		await writeFile(destination, source);
	});
	const uploads = [];
	const fetcher = async (_input, init) => {
		const chunks = [];
		for await (const chunk of init.body) chunks.push(chunk);
		uploads.push({
			key: init.headers["Idempotency-Key"],
			bytes: Buffer.concat(chunks).toString(),
		});
		return uploads.length === 1
			? Response.json(
					{ error: { message: "Retry registration" } },
					{ status: 503 },
				)
			: Response.json(
					{
						id: "11111111-1111-4111-8111-111111111111",
						url: "https://lixray.test/lix/11111111-1111-4111-8111-111111111111",
					},
					{ status: 201 },
				);
	};
	try {
		const makeService = () =>
			createShareService({
				runtime,
				getLix: async () => ({ exportShareSnapshot: exported }),
				fetcher,
			});
		await expect(makeService().connect({ path: root }, {})).rejects.toThrow(
			"Retry registration",
		);
		source = "edited source";
		expect(await makeService().connect({ path: root }, {})).toEqual({
			reload: true,
		});
		expect(uploads[0]).toEqual(uploads[1]);
		expect(exported).toHaveBeenCalledOnce();
		await expect(readFile(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("publication waits for content equality, not just the same file id", async () => {
	const content = new TextEncoder().encode("new content");
	let reads = 0,
		published = false;
	const connection = {
		accountId: "owner",
		repository: {
			id: "11111111-1111-4111-8111-111111111111",
			url: "https://lixray.test/lix/11111111-1111-4111-8111-111111111111",
		},
	};
	const runtime = {
		origin: "https://lixray.test",
		auth: { token: async () => "token", subject: async () => "owner" },
		errors: new Map(),
		store: { getConnection: async () => connection },
	};
	const close = vi.fn();
	const service = createShareService({
		runtime,
		getLix: async () => ({
			execute: async () => ({ rows: [{ id: "file", content }] }),
		}),
		openRemote: async () => ({
			execute: async () => ({
				rows: [
					{
						id: "file",
						content:
							++reads === 1 ? new TextEncoder().encode("stale") : content,
					},
				],
			}),
			close,
		}),
		waitForSync: async () => {
			expect(published).toBe(false);
		},
		fetcher: async () => {
			published = true;
			return Response.json({ published: true });
		},
	});
	expect(
		await service.publish({ path: "/workspace" }, {}, "/a.md", true),
	).toEqual({ published: true });
	expect(reads).toBe(2);
	expect(close).toHaveBeenCalledOnce();
});
