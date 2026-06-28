import type {
	GranularReviewChange,
	ReviewDecision,
} from "./granular-review-plan";

// State machine for the per-change review stepper, kept separate from the view
// so it can be reasoned about (and tested) on its own.

export type CarriedDecision = {
	readonly decision: "accepted" | "rejected";
	readonly signature: string;
};

export type StepperState = {
	readonly reviewId: string;
	readonly decisions: readonly ReviewDecision[];
	readonly activeIndex: number;
	/** Set the instant a resolution is submitted, to disable every control. */
	readonly submitting: boolean;
	/** Set after a short delay so "Applying…" does not flash for a fast write. */
	readonly showApplying: boolean;
	readonly error: boolean;
};

export type StepperAction =
	| { type: "reset"; reviewId: string; count: number }
	| {
			type: "rehydrate";
			reviewId: string;
			decisions: readonly ReviewDecision[];
			activeIndex: number;
	  }
	| { type: "decide"; index: number; decision: "accepted" | "rejected" }
	| { type: "decideRemaining"; decision: "accepted" | "rejected" }
	| { type: "navigate"; index: number }
	| { type: "beginSubmit" }
	| { type: "beginApplying" }
	| { type: "applyFailed" };

export function initStepperState(args: {
	reviewId: string;
	count: number;
}): StepperState {
	return {
		reviewId: args.reviewId,
		decisions: Array.from({ length: args.count }, () => "pending" as const),
		activeIndex: 0,
		submitting: false,
		showApplying: false,
		error: false,
	};
}

export function nextPendingIndex(
	decisions: readonly ReviewDecision[],
	from: number,
): number {
	for (let offset = 1; offset <= decisions.length; offset += 1) {
		const index = (from + offset) % decisions.length;
		if (decisions[index] === "pending") return index;
	}
	return from;
}

export function stepperReducer(
	state: StepperState,
	action: StepperAction,
): StepperState {
	switch (action.type) {
		case "reset":
			return initStepperState(action);
		case "rehydrate":
			return {
				reviewId: action.reviewId,
				decisions: action.decisions,
				activeIndex: action.activeIndex,
				submitting: false,
				showApplying: false,
				error: false,
			};
		case "decide": {
			const decisions = state.decisions.map((decision, index) =>
				index === action.index ? action.decision : decision,
			);
			return {
				...state,
				decisions,
				activeIndex: nextPendingIndex(decisions, action.index),
				error: false,
			};
		}
		case "decideRemaining": {
			const decisions = state.decisions.map((decision) =>
				decision === "pending" ? action.decision : decision,
			);
			return { ...state, decisions, error: false };
		}
		case "navigate":
			return { ...state, activeIndex: action.index };
		case "beginSubmit":
			return { ...state, submitting: true, showApplying: false, error: false };
		case "beginApplying":
			return state.submitting ? { ...state, showApplying: true } : state;
		case "applyFailed":
			return { ...state, submitting: false, showApplying: false, error: true };
		default:
			return state;
	}
}

/**
 * Seed decisions for a new (or folded) review. A decision is carried when its
 * change is unchanged (same key and signature); a change whose content evolved,
 * or a brand-new change, starts pending. The active index is the first pending
 * change.
 */
export function rehydrateDecisions(
	changes: readonly GranularReviewChange[],
	carried: ReadonlyMap<string, CarriedDecision>,
): { decisions: ReviewDecision[]; activeIndex: number } {
	const decisions: ReviewDecision[] = changes.map((change) => {
		const prior = carried.get(change.key);
		return prior && prior.signature === change.signature
			? prior.decision
			: "pending";
	});
	const firstPending = decisions.findIndex((d) => d === "pending");
	return { decisions, activeIndex: firstPending < 0 ? 0 : firstPending };
}

/** Record the current decided changes so they can be carried across a fold. */
export function recordDecisions(
	changes: readonly GranularReviewChange[],
	decisions: readonly ReviewDecision[],
	into: Map<string, CarriedDecision>,
): void {
	changes.forEach((change, index) => {
		const decision = decisions[index];
		if (decision === "accepted" || decision === "rejected") {
			into.set(change.key, { decision, signature: change.signature });
		}
	});
}
