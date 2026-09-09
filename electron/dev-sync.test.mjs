// @vitest-environment node
import { test } from "vitest";
import assert from "node:assert/strict";
import { getDevSyncServer } from "./dev-sync.mjs";

test("dev sync is limited to the selected persistent workspace", () => {
	const env = {
		FLASHTYPE_DEV_RUNTIME: "1",
		FLASHTYPE_DEV_SYNC_URL: "http://127.0.0.1:8088/lix/id",
		FLASHTYPE_DEV_SYNC_WORKSPACE: "/tmp/sync-demo",
		FLASHTYPE_DEV_SYNC_TOKEN: "test",
	};
	assert.equal(getDevSyncServer({ path: "/tmp/other" }, env), undefined);
	assert.equal(
		getDevSyncServer({ path: "/tmp/sync-demo", ephemeral: true }, env),
		undefined,
	);
	assert.equal(
		getDevSyncServer(
			{ path: "/tmp/sync-demo" },
			{ ...env, FLASHTYPE_DEV_RUNTIME: "0" },
		),
		undefined,
	);
	assert.deepEqual(getDevSyncServer({ path: "/tmp/sync-demo" }, env), {
		url: env.FLASHTYPE_DEV_SYNC_URL,
		headers: { Authorization: "Bearer test" },
	});
});
