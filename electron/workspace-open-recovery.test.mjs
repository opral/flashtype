// @vitest-environment node
import {
	mkdtemp,
	mkdir,
	writeFile,
	readFile,
	rm,
	access,
	symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, test } from "vitest";
import {
	applyScheduledWorkspaceLixDeletion,
	scheduleWorkspaceLixDeletion,
} from "./workspace-open-recovery.mjs";
import {
	writeWorkspaceRecoverySync,
	readWorkspaceRecovery,
	markWorkspaceLixOpenPendingSync,
	recoverPendingWorkspaceLixOpenSync,
} from "./workspace-recovery.mjs";
const roots = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});
async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), "flashtype-recovery-"));
	roots.push(root);
	const workspace = path.join(root, "workspace");
	const userData = path.join(root, "user-data");
	await mkdir(path.join(workspace, ".lix"), { recursive: true });
	await mkdir(userData);
	await writeFile(path.join(workspace, "notes.md"), "keep me");
	await writeFile(path.join(workspace, ".lix", "history"), "history");
	return { root, workspace, userData };
}
test("scheduling preserves history; startup deletes only .lix and clears stale recovery once", async () => {
	const { workspace, userData } = await fixture();
	writeWorkspaceRecoverySync(userData, { workspacePath: workspace });
	markWorkspaceLixOpenPendingSync(userData, { workspacePath: workspace });
	await scheduleWorkspaceLixDeletion(userData, workspace);
	expect(await readFile(path.join(workspace, ".lix", "history"), "utf8")).toBe(
		"history",
	);
	await applyScheduledWorkspaceLixDeletion(userData);
	await expect(access(path.join(workspace, ".lix"))).rejects.toThrow();
	expect(await readFile(path.join(workspace, "notes.md"), "utf8")).toBe(
		"keep me",
	);
	expect(await readWorkspaceRecovery(userData, workspace)).toBeNull();
	expect(recoverPendingWorkspaceLixOpenSync(userData)).toBe(0);
	await mkdir(path.join(workspace, ".lix"));
	await applyScheduledWorkspaceLixDeletion(userData);
	await access(path.join(workspace, ".lix"));
});
test("does not follow a .lix symlink into another folder", async () => {
	const { root, workspace, userData } = await fixture();
	const target = path.join(root, "other");
	await mkdir(target);
	await writeFile(path.join(target, "keep"), "safe");
	await rm(path.join(workspace, ".lix"), { recursive: true });
	await symlink(target, path.join(workspace, ".lix"));
	await scheduleWorkspaceLixDeletion(userData, workspace);
	await applyScheduledWorkspaceLixDeletion(userData);
	expect(await readFile(path.join(target, "keep"), "utf8")).toBe("safe");
});
