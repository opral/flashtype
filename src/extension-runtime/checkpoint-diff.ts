export type CheckpointDiffFileStatus =
	| "added"
	| "deleted"
	| "modified"
	| "recreated";

export type CheckpointDiffFile = {
	readonly fileId: string;
	readonly path: string;
	readonly beforePath: string | null;
	readonly afterPath: string | null;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly reviewId: string;
	readonly status: CheckpointDiffFileStatus;
};

export type CheckpointDiffVisibleFile = {
	readonly fileId: string;
	readonly path: string;
};

export type CheckpointDiff = {
	readonly branchId: string;
	readonly branchName: string;
	readonly beforeBranchId: string;
	readonly beforeBranchName: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly afterIsActiveHead?: boolean;
	readonly visibleFiles?: readonly CheckpointDiffVisibleFile[];
	readonly files: readonly CheckpointDiffFile[];
};

export type CheckpointDiffBranchRow = {
	readonly id: string;
	readonly name: string;
	readonly commit_id: string | null;
};

export type ShowCheckpointDiffArgs = {
	readonly branchId: string;
	readonly branches: readonly CheckpointDiffBranchRow[];
};
