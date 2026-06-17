export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly beforeDepth?: number;
	readonly afterDepth?: number;
};

export const EXTERNAL_WRITE_REVIEW_LAUNCH_ARG = "externalWriteReview";
