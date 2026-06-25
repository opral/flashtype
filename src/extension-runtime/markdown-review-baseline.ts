import type { Lix } from "@/lib/lix-types";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import {
	markFlashtypeFileWrite,
	type CancelFlashtypeFileWrite,
} from "./external-write-tracking";

/**
 * Ensure a freshly-ingested Markdown file has a tracked Lix baseline commit, so
 * the FIRST external edit can be reviewed per-change instead of all-or-nothing.
 *
 * Files scanned from disk at boot are ingested as UNTRACKED state with no
 * observed commit id. The first external write therefore has no real "before"
 * commit, the before-side `markdown_block` snapshots cannot be loaded, and the
 * granular planner falls back to the classic review.
 *
 * Writing the file's EXACT current bytes back through Lix promotes that
 * untracked state into a tracked commit — which materializes `markdown_block`
 * snapshots and usable history — WITHOUT changing the file on disk, because
 * identical bytes are a disk no-op. On state that is already tracked, an
 * identical write produces no new commit, so this is idempotent and cheap to
 * call repeatedly.
 *
 * The write is registered as an exact self-write so it can never open a review
 * of itself (and is a no-op for the detector regardless, since the content hash
 * is unchanged). Reading and re-writing inside one transaction guarantees the
 * bytes written are exactly the bytes present, so a concurrent external write
 * can never be clobbered. Failures are swallowed: a missing baseline simply
 * leaves the first external write on the classic path.
 */
export async function ensureMarkdownReviewBaseline(
	lix: Lix,
	fileId: string,
): Promise<void> {
	let cancel: CancelFlashtypeFileWrite = () => {};
	try {
		const wrote = await lix.transaction(async (tx) => {
			const current = await tx.execute(
				"SELECT data FROM lix_file WHERE id = ?",
				[fileId],
			);
			if (current.rows.length === 0) return false;
			const bytes = decodeFileDataToBytes(current.rows[0]?.get("data"));
			cancel = markFlashtypeFileWrite(fileId, bytes);
			await tx.execute("UPDATE lix_file SET data = ? WHERE id = ?", [
				bytes,
				fileId,
			]);
			return true;
		});
		if (!wrote) cancel();
	} catch {
		cancel();
	}
}
