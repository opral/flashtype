import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
	clearWorkspaceLixOpenPendingSync,
	clearWorkspaceRecoverySync,
	writeWorkspaceRecoverySync,
} from "./workspace-recovery.mjs";

export const RECOVERY_RESTART_EXIT_CODE = 75;
const REQUEST_FILE = "workspace-delete-lix-on-restart.json";

// Only called after the user explicitly chooses deletion. Never delete while
// the old process may still be opening or writing the repository.
export async function scheduleWorkspaceLixDeletion(
	userDataPath,
	workspacePath,
) {
	if (!path.isAbsolute(workspacePath))
		throw new Error("Expected an absolute workspace path.");
	const file = path.join(userDataPath, REQUEST_FILE);
	await writeFile(`${file}.tmp`, JSON.stringify({ workspacePath }), "utf8");
	await rename(`${file}.tmp`, file);
}

export async function applyScheduledWorkspaceLixDeletion(userDataPath) {
	const file = path.join(userDataPath, REQUEST_FILE);
	let request;
	try {
		request = JSON.parse(await readFile(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	// Consume once, even if deletion fails. A later restart must not unexpectedly
	// delete a repository the user subsequently repaired or initialized.
	await rm(file);
	const workspacePath = request?.workspacePath;
	if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
		throw new Error("Invalid repository recovery request.");
	}
	try {
		await rm(path.join(workspacePath, ".lix"), {
			recursive: true,
			force: true,
		});
		clearWorkspaceLixOpenPendingSync(userDataPath, workspacePath);
		clearWorkspaceRecoverySync(userDataPath, workspacePath);
	} catch (error) {
		clearWorkspaceLixOpenPendingSync(userDataPath, workspacePath);
		writeWorkspaceRecoverySync(userDataPath, {
			workspacePath,
			reason: "lix_deletion_failed",
			message: String(error),
		});
	}
}
