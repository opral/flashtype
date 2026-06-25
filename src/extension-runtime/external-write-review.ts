export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly beforeCommitId?: string;
	readonly afterCommitId?: string;
	readonly beforeDepth?: number;
	readonly afterDepth?: number;
	readonly agentTurnRangeId?: string;
};

export const EXTERNAL_WRITE_REVIEW_LAUNCH_ARG = "externalWriteReview";
