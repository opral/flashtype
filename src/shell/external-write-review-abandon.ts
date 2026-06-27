// Decision logic for the abandonment dialog's actions.
//
// A small pure module so its ordering rule — the destructive continuation runs
// only after the review has resolved, and only when the user's intent actually
// took effect — can be tested without the layout shell.

export type KeepProposedOutcome = "accepted" | "abandoned" | "noop";
export type RejectAllOutcome = "rejected" | "abandoned" | "noop";

/**
 * Resolve the "Keep proposed changes" branch of the abandonment dialog.
 *
 * The proposed (after) changes are kept by accepting the whole review. The
 * destructive continuation (closing/moving the view, or letting the window
 * close) runs ONLY after that acceptance has fully resolved, and only when the
 * proposed state was actually preserved.
 *
 * If the file changed since the review opened (`abandoned`), the continuation
 * is skipped and the optional `cancel` runs instead, rather than proceeding
 * against a buffer the user did not see.
 *
 * @returns `"continued"` when the continuation ran, `"cancelled"` otherwise.
 */
export async function keepProposedThenContinue(args: {
	readonly accept: () => Promise<KeepProposedOutcome>;
	readonly continuation: () => void;
	readonly cancel?: () => void;
}): Promise<"continued" | "cancelled"> {
	const outcome = await args.accept();
	if (outcome === "abandoned") {
		args.cancel?.();
		return "cancelled";
	}
	args.continuation();
	return "continued";
}

/**
 * Resolve the "Reject all changes" branch of the abandonment dialog.
 *
 * The proposed changes are discarded by rejecting the whole review (restoring
 * the before-state). The destructive continuation runs ONLY after that reject
 * resolves, and only when it actually restored the before-state. If the file
 * changed since the review opened (`abandoned`), the continuation is skipped
 * and the optional `cancel` runs instead.
 *
 * @returns `"continued"` when the continuation ran, `"cancelled"` otherwise.
 */
export async function rejectAllThenContinue(args: {
	readonly reject: () => Promise<RejectAllOutcome>;
	readonly continuation: () => void;
	readonly cancel?: () => void;
}): Promise<"continued" | "cancelled"> {
	const outcome = await args.reject();
	if (outcome === "abandoned") {
		args.cancel?.();
		return "cancelled";
	}
	args.continuation();
	return "continued";
}
