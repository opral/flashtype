import type { Lix } from "@/lib/lix-types";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
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
 * The mixed/all-rejected path runs in one Lix transaction that compares the
 * current `lix_file.data` byte-for-byte with the review's after-state and only
 * writes when they still match, so a newer external write is left intact. The
 * write is not recorded as an agent turn, so it does not reopen a review of
 * itself; the caller clears the agent-turn range entry once it succeeds.
 *
 * The all-accepted path writes nothing but still reads `lix_file.data` to
 * confirm it equals the after-state: a newer external write makes the
 * resolution `stale` (a deleted file `missing`) rather than clearing the review
 * against content the user did not see.
 */
export async function applyGranularReviewResolution(
	lix: Lix,
	resolution: GranularReviewResolution,
): Promise<GranularReviewResolutionResult> {
	const { fileId, resolvedData, afterData, acceptedCount, rejectedCount } =
		resolution;

	// All accepted: the file should already hold the after-state, so no write is
	// needed. Confirm it still matches byte-for-byte before reporting success, so
	// a newer external write cannot be mistaken for an accepted resolution.
	if (rejectedCount === 0 && acceptedCount > 0) {
		try {
			return await lix.transaction(async (tx) => {
				const current = await tx.execute(
					"SELECT data FROM lix_file WHERE id = ?",
					[fileId],
				);
				if (current.rows.length === 0) {
					return { outcome: "missing" as const };
				}
				const currentData = decodeFileDataToBytes(current.rows[0]?.get("data"));
				if (!bytesEqual(currentData, afterData)) {
					return { outcome: "stale" as const };
				}
				return { outcome: "accepted_existing" as const };
			});
		} catch (error) {
			return { outcome: "failed", error };
		}
	}

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
		return { outcome };
	} catch (error) {
		return { outcome: "failed", error };
	}
}

/**
 * Aggregate, content-free telemetry properties for a granular resolution. It
 * deliberately contains only counts and coarse flags — never Markdown content,
 * paths, block/change ids, order keys, or hashes.
 */
export function granularResolutionTelemetry(
	resolution: Pick<
		GranularReviewResolution,
		"acceptedCount" | "rejectedCount" | "usedRemainingAction"
	>,
): {
	review_mode: "granular";
	change_count: number;
	accepted_count: number;
	rejected_count: number;
	used_remaining_action: boolean;
} {
	return {
		review_mode: "granular",
		change_count: resolution.acceptedCount + resolution.rejectedCount,
		accepted_count: resolution.acceptedCount,
		rejected_count: resolution.rejectedCount,
		used_remaining_action: resolution.usedRemainingAction,
	};
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i += 1) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}
