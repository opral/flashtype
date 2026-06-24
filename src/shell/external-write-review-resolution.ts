import type { Lix } from "@/lib/lix-types";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import {
	markFlashtypeFileWrite,
	type CancelFlashtypeFileWrite,
} from "@/extension-runtime/external-write-tracking";
import type {
	GranularReviewResolution,
	GranularReviewResolutionOutcome,
} from "@/extension-runtime/external-write-review";

export type GranularReviewResolutionResult = {
	readonly outcome: GranularReviewResolutionOutcome;
	readonly error?: unknown;
};

/**
 * Persist a granular review resolution atomically.
 *
 * The mixed/all-rejected path runs inside a single Lix transaction that reads
 * the current `lix_file.data`, compares it byte-for-byte with the review's
 * after-state, and only writes when they still match. This guarantees a newer
 * external write is never overwritten. Self-write suppression is registered
 * with the exact canonical hash immediately before the update and canceled if
 * the transaction never commits, so the resolution write does not reopen a
 * fresh review of itself while never masking an unrelated write.
 */
export async function applyGranularReviewResolution(
	lix: Lix,
	resolution: GranularReviewResolution,
): Promise<GranularReviewResolutionResult> {
	const { fileId, resolvedData, afterData, acceptedCount, rejectedCount } =
		resolution;

	// All accepted: the file already holds the after-state, so no write is
	// needed and no fresh review can be triggered.
	if (rejectedCount === 0 && acceptedCount > 0) {
		return { outcome: "accepted_existing" };
	}

	// Register the exact canonical self-write expectation before the write can
	// become observable, then cancel it if the transaction does not commit the
	// write. This never opens a broad time-window ignore for the file.
	const cancelMarker: CancelFlashtypeFileWrite = markFlashtypeFileWrite(
		fileId,
		resolvedData,
	);
	try {
		const outcome = await lix.transaction(async (tx) => {
			const current = await tx.execute(
				"SELECT data FROM lix_file WHERE id = ?",
				[fileId],
			);
			if (current.rows.length === 0) {
				return "missing" as const;
			}
			const currentData = decodeFileDataToBytes(current.rows[0]?.get("data"));
			if (!bytesEqual(currentData, afterData)) {
				return "stale" as const;
			}
			await tx.execute("UPDATE lix_file SET data = ? WHERE id = ?", [
				resolvedData,
				fileId,
			]);
			return "applied" as const;
		});
		if (outcome !== "applied") {
			cancelMarker();
		}
		return { outcome };
	} catch (error) {
		cancelMarker();
		return { outcome: "failed", error };
	}
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i += 1) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}
