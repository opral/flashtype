// Seed a Track Changes (persistent .lix) workspace in a folder before launching
// the app, so E2E tests open a tracked folder that watches external edits.
//
// Run as a child process (it loads the built Lix SDK via require, which does not
// mix with Playwright's ESM test context):
//   node e2e/seed-lix-workspace.mjs <workspaceDir>
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = require(
	path.join(repoRoot, "submodule/lix/packages/js-sdk/dist/index.js"),
);
const { openLix, FsBackend, bundledPluginArchives } = sdk;

const workspaceDir = process.argv[2];
if (!workspaceDir) {
	throw new Error("usage: node seed-lix-workspace.mjs <workspaceDir>");
}

const lix = await openLix({ backend: new FsBackend({ path: workspaceDir }) });
try {
	for (const plugin of await bundledPluginArchives()) {
		await lix.execute(
			"INSERT INTO lix_file (path, data) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET data = excluded.data",
			[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
		);
	}
	// Give the backend a moment to flush the .lix to disk before we close.
	await new Promise((resolve) => setTimeout(resolve, 600));
} finally {
	await lix.close();
}
