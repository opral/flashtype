import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createLix, openLix, bundledPluginArchives } from "@lix-js/sdk";
import { FilesystemStorage } from "@lix-js/storage-filesystem";

const workspace = path.resolve(
	process.env.FLASHTYPE_DEV_SYNC_WORKSPACE ?? ".flashtype-dev/sync-workspace",
);
const server = process.env.FLASHTYPE_DEV_SYNC_SERVER ?? "http://127.0.0.1:8088";
const token = process.env.FLASHTYPE_DEV_SYNC_TOKEN ?? "flashtype-local-dev";
const stateDir = path.resolve(".flashtype-dev/sync-connections");
const key = createHash("sha256")
	.update(`${workspace}\n${server}`)
	.digest("hex");
const statePath = path.join(stateDir, `${key}.json`);
await mkdir(workspace, { recursive: true });
await mkdir(stateDir, { recursive: true });
let state;
try {
	state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
if (!state) {
	state = { workspace, server, idempotencyKey: randomUUID() };
	await writeFile(statePath, JSON.stringify(state, null, 2));
}
if (!state.repository) {
	const lix = await openLix({
		storage: new FilesystemStorage({ path: workspace }),
	});
	try {
		for (const plugin of await bundledPluginArchives()) {
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET content = excluded.content",
				[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
			);
		}
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ($1, $2) ON CONFLICT (path) DO NOTHING",
			[
				"/Sync demo.md",
				new TextEncoder().encode(
					"# Flashtype local sync\n\nEdit this file in Flashtype or on disk. Changes sync to the local Lix server.\n",
				),
			],
		);
		state.repository = await createLix({
			server: { url: server, headers: { Authorization: `Bearer ${token}` } },
			from: lix,
			idempotencyKey: state.idempotencyKey,
		});
		await writeFile(statePath, JSON.stringify(state, null, 2));
	} finally {
		await lix.close();
	}
}
console.log(`Syncing ${workspace} to ${state.repository.url}`);
const child = spawn(
	process.execPath,
	["scripts/dev.mjs", workspace, ...process.argv.slice(2)],
	{
		stdio: "inherit",
		env: {
			...process.env,
			FLASHTYPE_DEV_SYNC_WORKSPACE: workspace,
			FLASHTYPE_DEV_SYNC_URL: state.repository.url,
			FLASHTYPE_DEV_SYNC_TOKEN: token,
		},
	},
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
