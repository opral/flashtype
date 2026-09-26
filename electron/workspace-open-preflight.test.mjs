// @vitest-environment node
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, test } from "vitest";
import { assertWorkspaceCanOpen } from "./workspace-open-preflight.mjs";
import { writeWorkspaceRecoverySync } from "./workspace-recovery.mjs";
const roots = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
	);
});
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "flashtype-preflight-"));
	roots.push(root);
	const workspace = path.join(root, "Downloads");
	await mkdir(workspace);
	return { root, workspace };
}
test("blocks oversized existing repositories before native opening", async () => {
	const { root, workspace } = await fixture();
	await mkdir(path.join(workspace, ".lix"));
	const file = await open(path.join(workspace, "large.zip"), "w");
	await file.truncate(1_000_000_001);
	await file.close();
	await expect(assertWorkspaceCanOpen(root, workspace)).rejects.toThrow(
		"Cannot open persistent history",
	);
});
test("blocks a recorded crash even when the folder is below the limit", async () => {
	const { root, workspace } = await fixture();
	await writeFile(path.join(workspace, "note.md"), "safe");
	writeWorkspaceRecoverySync(root, {
		workspacePath: workspace,
		reason: "previous_lix_open_crash",
	});
	await expect(assertWorkspaceCanOpen(root, workspace)).rejects.toThrow(
		"needs recovery",
	);
});
test("allows a small repository without a crash report", async () => {
	const { root, workspace } = await fixture();
	await expect(
		assertWorkspaceCanOpen(root, workspace),
	).resolves.toBeUndefined();
});
