// Decision logic for the abandonment dialog's "Keep proposed changes" action.
//
// Kept as a small pure module so the ordering guarantee — the destructive
// continuation must run strictly after the review has resolved — can be tested
// in isolation, without standing up the whole layout shell.

export type KeepProposedOutcome = "accepted" | "abandoned" | "noop";

/**
 * Resolve the "Keep proposed changes" branch of the abandonment dialog.
 *
 * The proposed (after) changes are kept by accepting the whole review. The
 * destructive continuation (closing/moving the view, or letting the window
 * close) runs ONLY after that acceptance has fully resolved, and only when the
 * proposed state was actually preserved.
 *
 * If the file changed since the review opened (`abandoned`), the continuation
 * is skipped and the optional `cancel` runs instead, so the destructive action
 * never proceeds silently against a buffer the user never saw.
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
