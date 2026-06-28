export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly agentTurnRangeIds: readonly string[];
};

export type ExternalWriteReviewData = {
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
};

/**
 * Aggregate, content-free payload describing the outcome of a granular review
 * so the shell can apply it atomically and report aggregate telemetry. It never
 * carries Markdown content, paths, block ids, or hashes.
 */
export type GranularReviewResolution = {
	readonly fileId: string;
	readonly reviewId: string;
	/** Final canonical Lix projection bytes to persist for a mixed result. */
	readonly resolvedData: Uint8Array;
	/** The review's after-state bytes, used for the stale compare-and-write. */
	readonly afterData: Uint8Array;
	/** The review's before-state bytes, restored on an all-rejected result. */
	readonly beforeData: Uint8Array;
	readonly acceptedCount: number;
	readonly rejectedCount: number;
	readonly usedRemainingAction: boolean;
};

/**
 * Typed result of attempting to persist a granular resolution.
 *
 * - `applied`: the file matched the review and was updated once.
 * - `accepted_existing`: every change was accepted, so no write was needed.
 * - `stale`: the file changed since the review opened; nothing was written.
 * - `missing`: the file no longer exists.
 * - `failed`: the transaction threw; UI decisions must be retained.
 */
export type GranularReviewResolutionOutcome =
	| "applied"
	| "accepted_existing"
	| "stale"
	| "missing"
	| "failed";
