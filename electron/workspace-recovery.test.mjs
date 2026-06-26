import { mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	clearWorkspaceRecoverySync,
	markWorkspaceLixOpenPendingSync,
	readWorkspaceRecoveries,
	readWorkspaceRecovery,
	recoverPendingWorkspaceLixOpenSync,
	workspaceRecoveryToSessionEntry,
	writeWorkspaceRecoverySync,
	WORKSPACE_PENDING_LIX_OPEN_FILE,
} from "./workspace-recovery.mjs";

describe("workspace recovery store", () => {
	test("persists, reads, and clears workspace recovery entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		await mkdir(workspacePath, { recursive: true });

		writeWorkspaceRecoverySync(userDataPath, {
			kind: "track_changes",
			workspacePath,
			workspaceName: "workspace",
			reason: "renderer_crash",
			exitCode: 100,
			createdAt: "2026-06-25T12:00:00.000Z",
		});

		await expect(
			readWorkspaceRecovery(userDataPath, workspacePath),
		).resolves.toMatchObject({
			kind: "track_changes",
			workspacePath,
			workspaceName: "workspace",
			reason: "renderer_crash",
			exitCode: 100,
			createdAt: "2026-06-25T12:00:00.000Z",
		});
		expect(
			workspaceRecoveryToSessionEntry({
				kind: "track_changes",
				workspacePath,
				workspaceName: "workspace",
				reason: "renderer_crash",
				createdAt: "2026-06-25T12:00:00.000Z",
			}),
		).toEqual({ path: workspacePath, openFilePaths: [] });

		clearWorkspaceRecoverySync(userDataPath, workspacePath);

		await expect(
			readWorkspaceRecovery(userDataPath, workspacePath),
		).resolves.toBe(null);
	});

	test("converts stale pending Lix opens into recovery entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const missingWorkspacePath = path.join(userDataPath, "missing");
		await mkdir(workspacePath, { recursive: true });

		markWorkspaceLixOpenPendingSync(userDataPath, {
			kind: "track_changes",
			workspacePath,
			workspaceName: "workspace",
			reason: "lix_open_pending",
			createdAt: "2026-06-25T12:00:00.000Z",
		});
		markWorkspaceLixOpenPendingSync(userDataPath, {
			kind: "track_changes",
			workspacePath: missingWorkspacePath,
			workspaceName: "missing",
			reason: "lix_open_pending",
			createdAt: "2026-06-25T12:00:00.000Z",
		});

		expect(recoverPendingWorkspaceLixOpenSync(userDataPath)).toBe(1);
		await expect(
			readWorkspaceRecovery(userDataPath, workspacePath),
		).resolves.toMatchObject({
			workspacePath,
			reason: "previous_lix_open_crash",
		});
		await expect(
			readWorkspaceRecovery(userDataPath, missingWorkspacePath),
		).resolves.toBe(null);
		await expect(
			stat(path.join(userDataPath, WORKSPACE_PENDING_LIX_OPEN_FILE)),
		).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("drops recovery entries whose workspace no longer exists", async () => {
		const userDataPath = createUserDataPath();
		const missingWorkspacePath = path.join(userDataPath, "missing");

		writeWorkspaceRecoverySync(userDataPath, {
			kind: "track_changes",
			workspacePath: missingWorkspacePath,
			workspaceName: "missing",
			reason: "renderer_crash",
			createdAt: "2026-06-25T12:00:00.000Z",
		});

		await expect(readWorkspaceRecoveries(userDataPath)).resolves.toEqual([]);
	});
});

function createUserDataPath() {
	return path.join(tmpdir(), "flashtype-workspace-recovery-test", randomUUID());
}
