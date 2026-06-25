import type { Lix } from "@/lib/lix-types";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";

/**
 * Ensure a freshly-ingested Markdown file has a tracked Lix baseline commit, so
 * the FIRST external edit can be reviewed per-change instead of all-or-nothing.
 *
 * Files scanned from disk at boot are ingested as UNTRACKED state with no
 * observed commit id. The first external write therefore has no real "before"
 * commit, the before-side `markdown_block` snapshots cannot be loaded, and the
 * granular planner falls back to the classic review.
 *
 * Writing the file's current bytes back through Lix promotes that untracked
 * state into a tracked commit — which materializes `markdown_block` snapshots
 * and usable history — WITHOUT changing the file on disk, because the bytes are
 * identical. On state that is already tracked, an identical write produces no
 * new commit, so this is idempotent and cheap to call repeatedly.
 *
 * `expectedData` is the content observed when the file first entered the
 * workspace. The write is a compare-and-write that only runs while the file
 * still holds those bytes, so a newer external write that raced ahead is left
 * intact. No self-write suppression is needed: an identical-bytes write leaves
 * the content hash unchanged, so the detector does not treat it as an edit.
 * Failures are swallowed; a missing baseline leaves the first edit on classic.
 */
export async function ensureMarkdownReviewBaseline(
	lix: Lix,
	fileId: string,
	expectedData: Uint8Array,
): Promise<void> {
	try {
		await lix.transaction(async (tx) => {
			const current = await tx.execute(
				"SELECT data FROM lix_file WHERE id = ?",
				[fileId],
			);
			if (current.rows.length === 0) return;
			const currentBytes = decodeFileDataToBytes(current.rows[0]?.get("data"));
			// Only promote the baseline while the file still holds the exact bytes
			// we observed. A newer external write must be left untouched so its
			// review is never suppressed or overwritten.
			if (!bytesEqual(currentBytes, expectedData)) return;
			await tx.execute("UPDATE lix_file SET data = ? WHERE id = ?", [
				expectedData,
				fileId,
			]);
		});
	} catch {
		// Best-effort: a missing baseline just leaves the first edit on classic.
	}
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i += 1) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}
