import { readWorkspaceRecovery } from "./workspace-recovery.mjs";
import { inspectRepositorySize } from "./repository-limits.mjs";

// Run before constructing filesystem storage or calling the native SDK. A
// renderer retry or a background IPC request must not bypass crash recovery.
export async function assertWorkspaceCanOpen(userDataPath, workspacePath) {
	const recovery = await readWorkspaceRecovery(userDataPath, workspacePath);
	if (recovery) {
		throw new Error(
			"This repository needs recovery. Delete .lix or explicitly choose Try again before opening it.",
		);
	}
	const size = await inspectRepositorySize(workspacePath);
	if (!size.allowed) {
		throw new Error(
			"Cannot open persistent history: this folder exceeds the 1 GB total-size limit. Delete .lix to open the folder with temporary history. Your normal files will be preserved.",
		);
	}
}
