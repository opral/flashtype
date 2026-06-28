// A tiny framework-agnostic registry of "review guards". A guard reports
// whether a mounted Markdown review currently holds partial (some decided, some
// pending) decisions that would be lost if its overlay were destroyed. The
// shell consults the registry before running a destructive view/window action
// and, when a guard has pending decisions, shows the abandonment dialog instead
// of silently discarding the buffer.

export type ReviewGuard = {
	readonly reviewId: string;
	readonly fileId: string;
	/** True when there are partial decisions that abandoning would discard. */
	readonly hasPendingDecisions: () => boolean;
};

export type ReviewGuardRegistry = {
	register: (guard: ReviewGuard) => () => void;
	/** The first registered guard that currently has pending decisions, if any. */
	pendingGuard: () => ReviewGuard | null;
	/** Every registered guard that currently has pending decisions. */
	pendingGuards: () => ReviewGuard[];
	hasPendingDecisions: () => boolean;
};

export function createReviewGuardRegistry(): ReviewGuardRegistry {
	const guards = new Set<ReviewGuard>();
	return {
		register(guard) {
			guards.add(guard);
			return () => {
				guards.delete(guard);
			};
		},
		pendingGuard() {
			for (const guard of guards) {
				if (guard.hasPendingDecisions()) return guard;
			}
			return null;
		},
		pendingGuards() {
			const pending: ReviewGuard[] = [];
			for (const guard of guards) {
				if (guard.hasPendingDecisions()) pending.push(guard);
			}
			return pending;
		},
		hasPendingDecisions() {
			for (const guard of guards) {
				if (guard.hasPendingDecisions()) return true;
			}
			return false;
		},
	};
}
