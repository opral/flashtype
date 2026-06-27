import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChevronUp, ChevronDown, MoreHorizontal } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GranularReviewPlan } from "./granular-review-plan";
import type {
	GranularReviewResolution,
	GranularReviewResolutionOutcome,
} from "@/extension-runtime/external-write-review";
import {
	initStepperState,
	rehydrateDecisions,
	recordDecisions,
	stepperReducer,
	type CarriedDecision,
} from "./markdown-review-stepper-state";
import {
	highlightTargets,
	isMacPlatform,
	revealIfNeeded,
} from "./markdown-review-stepper-dom";
import { useReviewStepperShortcuts } from "./markdown-review-stepper-keyboard";
import "./markdown-review-stepper.css";

const APPLYING_DELAY_MS = 150;

export type MarkdownReviewStepperProps = {
	readonly plan: GranularReviewPlan;
	readonly reviewId: string;
	readonly fileId: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly isActive: boolean;
	readonly diffContainerRef: RefObject<HTMLElement | null>;
	readonly onResolve: (
		resolution: GranularReviewResolution,
	) => Promise<GranularReviewResolutionOutcome>;
	/**
	 * Reports whether the buffer currently holds partial decisions (some
	 * decided, some pending) so the shell can guard against discarding them.
	 */
	readonly onPendingDecisionsChange?: (hasPendingDecisions: boolean) => void;
};

export function MarkdownReviewStepper({
	plan,
	reviewId,
	fileId,
	beforeData,
	afterData,
	isActive,
	diffContainerRef,
	onResolve,
	onPendingDecisionsChange,
}: MarkdownReviewStepperProps) {
	const changes = plan.changes;
	const [state, dispatch] = useReducer(
		stepperReducer,
		{ reviewId, count: changes.length },
		initStepperState,
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const submittedRef = useRef(false);
	const applyTimerRef = useRef<number | null>(null);
	// Decisions made in this review session, keyed by stable change key, so a
	// sequential external write that folds into the open review (new reviewId,
	// same before-anchor) can keep prior choices. Cleared when the anchor changes.
	const decidedByKeyRef = useRef(new Map<string, CarriedDecision>());
	const sessionBeforeRef = useRef<string | null>(null);

	// Take over for a new (or folded) review, carrying still-valid decisions. A
	// change of before-anchor starts a fresh session.
	useEffect(() => {
		if (state.reviewId === reviewId) {
			// Anchor the session on first mount so the first fold reads as a fold,
			// not a new session (which would clear the carried decisions).
			if (sessionBeforeRef.current === null) {
				sessionBeforeRef.current = hashBytes(beforeData);
			}
			return;
		}
		submittedRef.current = false;
		const beforeKey = hashBytes(beforeData);
		if (sessionBeforeRef.current !== beforeKey) {
			decidedByKeyRef.current.clear();
			sessionBeforeRef.current = beforeKey;
		}
		const { decisions, activeIndex } = rehydrateDecisions(
			changes,
			decidedByKeyRef.current,
		);
		dispatch({ type: "rehydrate", reviewId, decisions, activeIndex });
	}, [reviewId, changes, beforeData, state.reviewId]);

	// Record decided changes so they can be carried if the review folds. Guarded
	// on reviewId match so the previous plan's decisions are not recorded against
	// the new plan's changes.
	useEffect(() => {
		if (state.reviewId !== reviewId) return;
		recordDecisions(changes, state.decisions, decidedByKeyRef.current);
	}, [state.decisions, changes, reviewId, state.reviewId]);

	const total = changes.length;
	const activeChange = changes[state.activeIndex];
	const usedRemainingRef = useRef(false);
	const pendingCount = state.decisions.filter((d) => d === "pending").length;
	const decidedCount = total - pendingCount;
	const hasPartialDecisions =
		decidedCount > 0 && pendingCount > 0 && !state.submitting;

	// Surface partial-decision state to the shell's abandonment guard.
	useEffect(() => {
		onPendingDecisionsChange?.(hasPartialDecisions);
		return () => onPendingDecisionsChange?.(false);
	}, [hasPartialDecisions, onPendingDecisionsChange]);

	const submit = useCallback(() => {
		if (submittedRef.current) return;
		const decisionMap = new Map<string, "accepted" | "rejected">();
		let acceptedCount = 0;
		let rejectedCount = 0;
		changes.forEach((change, index) => {
			const decision = state.decisions[index];
			if (decision !== "accepted" && decision !== "rejected") return;
			decisionMap.set(change.id, decision);
			if (decision === "accepted") acceptedCount += 1;
			else rejectedCount += 1;
		});
		if (decisionMap.size !== changes.length) return;

		submittedRef.current = true;
		const resolvedData = plan.resolve(decisionMap);
		const resolution: GranularReviewResolution = {
			fileId,
			reviewId,
			resolvedData,
			afterData,
			beforeData,
			acceptedCount,
			rejectedCount,
			usedRemainingAction: usedRemainingRef.current,
		};

		// Disable controls immediately; only show "Applying…" if the write is slow
		// enough to need it, so fast resolutions do not flash it.
		dispatch({ type: "beginSubmit" });
		applyTimerRef.current = window.setTimeout(() => {
			dispatch({ type: "beginApplying" });
		}, APPLYING_DELAY_MS);

		void onResolve(resolution)
			.then((outcome) => {
				if (outcome === "failed") {
					submittedRef.current = false;
					dispatch({ type: "applyFailed" });
				}
				// On success the shell clears the review and this overlay unmounts.
			})
			.catch(() => {
				submittedRef.current = false;
				dispatch({ type: "applyFailed" });
			})
			.finally(() => {
				if (applyTimerRef.current !== null) {
					window.clearTimeout(applyTimerRef.current);
					applyTimerRef.current = null;
				}
			});
	}, [
		afterData,
		beforeData,
		changes,
		fileId,
		onResolve,
		plan,
		reviewId,
		state.decisions,
	]);

	// Auto-apply once every change has been decided.
	useEffect(() => {
		if (state.error || state.submitting) return;
		if (total === 0) return;
		const allDecided = state.decisions.every((d) => d !== "pending");
		if (allDecided) submit();
	}, [state.decisions, state.error, state.submitting, total, submit]);

	useEffect(
		() => () => {
			if (applyTimerRef.current !== null) {
				window.clearTimeout(applyTimerRef.current);
			}
		},
		[],
	);

	const decide = useCallback(
		(decision: "accepted" | "rejected") => {
			if (state.submitting) return;
			dispatch({ type: "decide", index: state.activeIndex, decision });
		},
		[state.activeIndex, state.submitting],
	);

	const navigate = useCallback(
		(direction: -1 | 1) => {
			if (total === 0) return;
			const index = Math.min(
				total - 1,
				Math.max(0, state.activeIndex + direction),
			);
			dispatch({ type: "navigate", index });
		},
		[state.activeIndex, total],
	);

	const decideRemaining = useCallback(
		(decision: "accepted" | "rejected") => {
			if (state.submitting) return;
			usedRemainingRef.current = true;
			setMenuOpen(false);
			dispatch({ type: "decideRemaining", decision });
		},
		[state.submitting],
	);

	const retry = useCallback(() => {
		submittedRef.current = false;
		submit();
	}, [submit]);

	const acceptActive = useCallback(() => decide("accepted"), [decide]);
	const rejectActive = useCallback(() => decide("rejected"), [decide]);

	// Highlight and reveal the active change's block(s) in the static diff.
	useEffect(() => {
		const container = diffContainerRef.current;
		if (!container || !activeChange) return;
		const targets = highlightTargets(container, activeChange);
		for (const target of targets) {
			target.classList.add("markdown-review-active-block");
		}
		if (targets[0]) revealIfNeeded(container, targets[0]);
		return () => {
			for (const target of targets) {
				target.classList.remove("markdown-review-active-block");
			}
		};
	}, [activeChange, diffContainerRef, state.decisions]);

	useReviewStepperShortcuts({
		active: isActive,
		rejectBlocked: menuOpen || state.error,
		onAccept: acceptActive,
		onReject: rejectActive,
		onNavigate: navigate,
	});

	if (total === 0) return null;

	const activeDecision = state.decisions[state.activeIndex] ?? "pending";
	const counterLabel = `${state.activeIndex + 1} of ${total}`;

	return (
		<div
			className="markdown-review-stepper"
			data-testid="markdown-review-stepper"
			role="group"
			aria-label="Per-change review actions"
			data-applying={state.showApplying ? "true" : undefined}
			data-submitting={state.submitting ? "true" : undefined}
		>
			<span
				className="markdown-review-live"
				aria-live="polite"
				aria-atomic="true"
			>
				{`Change ${state.activeIndex + 1} of ${total}`}
			</span>

			{state.error ? (
				<div className="markdown-review-error" role="alert">
					<span>Couldn&rsquo;t apply review</span>
					<button
						type="button"
						className="markdown-review-button markdown-review-button-retry"
						onClick={retry}
					>
						Retry
					</button>
				</div>
			) : (
				<>
					<div className="markdown-review-nav">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="markdown-review-chevron"
									aria-label="Previous change"
									disabled={state.submitting || state.activeIndex === 0}
									onClick={() => navigate(-1)}
								>
									<ChevronUp aria-hidden />
								</button>
							</TooltipTrigger>
							<TooltipContent>Previous change (⌥↑)</TooltipContent>
						</Tooltip>
						<span className="markdown-review-counter" aria-hidden="true">
							{counterLabel}
						</span>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="markdown-review-chevron"
									aria-label="Next change"
									disabled={state.submitting || state.activeIndex === total - 1}
									onClick={() => navigate(1)}
								>
									<ChevronDown aria-hidden />
								</button>
							</TooltipTrigger>
							<TooltipContent>Next change (⌥↓)</TooltipContent>
						</Tooltip>
						<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="markdown-review-chevron"
									aria-label="More review actions"
									disabled={state.submitting || pendingCount === 0}
								>
									<MoreHorizontal aria-hidden />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="center">
								<DropdownMenuItem onSelect={() => decideRemaining("accepted")}>
									{`Accept ${pendingCount} remaining`}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => decideRemaining("rejected")}>
									{`Reject ${pendingCount} remaining`}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					<div className="markdown-review-decisions">
						<button
							type="button"
							className="markdown-review-button markdown-review-button-reject"
							data-chosen={activeDecision === "rejected" ? "true" : undefined}
							disabled={state.submitting}
							onClick={() => decide("rejected")}
						>
							<span>Reject</span>
							<kbd className="markdown-review-shortcut markdown-review-shortcut-dark">
								Esc
							</kbd>
						</button>
						<button
							type="button"
							className="markdown-review-button markdown-review-button-accept"
							data-chosen={activeDecision === "accepted" ? "true" : undefined}
							disabled={state.submitting}
							onClick={() => decide("accepted")}
						>
							<span>Accept</span>
							<kbd className="markdown-review-shortcut">
								{isMacPlatform() ? "⌘↩" : "Ctrl↩"}
							</kbd>
						</button>
					</div>

					{state.showApplying ? (
						<span className="markdown-review-applying" role="status">
							Applying…
						</span>
					) : null}
				</>
			)}
		</div>
	);
}

// Stable content key for the before-state bytes, used only to detect when a
// review's before-anchor changes (which starts a fresh decision session).
function hashBytes(bytes: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i += 1) {
		hash ^= bytes[i]!;
		hash = Math.imul(hash, 0x01000193);
	}
	return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}
