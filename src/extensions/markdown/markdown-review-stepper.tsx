import {
	useCallback,
	useEffect,
	useReducer,
	useRef,
	useState,
	type RefObject,
} from "react";
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
import type {
	GranularReviewPlan,
	ReviewDecision,
} from "./granular-review-plan";
import type {
	GranularReviewResolution,
	GranularReviewResolutionOutcome,
} from "@/extension-runtime/external-write-review";
import "./markdown-review-stepper.css";

const APPLYING_DELAY_MS = 150;

type StepperState = {
	readonly reviewId: string;
	readonly decisions: readonly ReviewDecision[];
	readonly activeIndex: number;
	readonly applying: boolean;
	readonly error: boolean;
};

type StepperAction =
	| { type: "reset"; reviewId: string; count: number }
	| { type: "decide"; index: number; decision: "accepted" | "rejected" }
	| { type: "decideRemaining"; decision: "accepted" | "rejected" }
	| { type: "navigate"; index: number }
	| { type: "beginApply" }
	| { type: "applyFailed" };

function initState(args: { reviewId: string; count: number }): StepperState {
	return {
		reviewId: args.reviewId,
		decisions: Array.from({ length: args.count }, () => "pending" as const),
		activeIndex: 0,
		applying: false,
		error: false,
	};
}

function nextPendingIndex(
	decisions: readonly ReviewDecision[],
	from: number,
): number {
	for (let offset = 1; offset <= decisions.length; offset += 1) {
		const index = (from + offset) % decisions.length;
		if (decisions[index] === "pending") return index;
	}
	return from;
}

function reducer(state: StepperState, action: StepperAction): StepperState {
	switch (action.type) {
		case "reset":
			return initState(action);
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
		case "beginApply":
			return { ...state, applying: true, error: false };
		case "applyFailed":
			return { ...state, applying: false, error: true };
		default:
			return state;
	}
}

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
		reducer,
		{
			reviewId,
			count: changes.length,
		},
		initState,
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const submittedRef = useRef(false);
	const applyTimerRef = useRef<number | null>(null);

	// Reset the buffer whenever a new review takes over this overlay.
	useEffect(() => {
		if (state.reviewId !== reviewId) {
			submittedRef.current = false;
			dispatch({ type: "reset", reviewId, count: changes.length });
		}
	}, [reviewId, changes.length, state.reviewId]);

	const total = changes.length;
	const activeChange = changes[state.activeIndex];
	const usedRemainingRef = useRef(false);
	const pendingCount = state.decisions.filter((d) => d === "pending").length;
	const decidedCount = total - pendingCount;
	const hasPartialDecisions =
		decidedCount > 0 && pendingCount > 0 && !state.applying;

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

		// Only surface the "Applying…" state if the write is slow enough to need
		// it, so fast resolutions never flash.
		applyTimerRef.current = window.setTimeout(() => {
			dispatch({ type: "beginApply" });
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
		if (state.error || state.applying) return;
		if (total === 0) return;
		const allDecided = state.decisions.every((d) => d !== "pending");
		if (allDecided) submit();
	}, [state.decisions, state.error, state.applying, total, submit]);

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
			if (state.applying) return;
			dispatch({ type: "decide", index: state.activeIndex, decision });
		},
		[state.activeIndex, state.applying],
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
			if (state.applying) return;
			usedRemainingRef.current = true;
			setMenuOpen(false);
			dispatch({ type: "decideRemaining", decision });
		},
		[state.applying],
	);

	const retry = useCallback(() => {
		submittedRef.current = false;
		submit();
	}, [submit]);

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

	// Scoped keyboard handling: only while this review is the active surface and
	// no overlay (dropdown/error) owns the key.
	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (event.altKey && !event.metaKey && !event.ctrlKey) {
				if (event.key === "ArrowUp") {
					event.preventDefault();
					event.stopPropagation();
					navigate(-1);
					return;
				}
				if (event.key === "ArrowDown") {
					event.preventDefault();
					event.stopPropagation();
					navigate(1);
					return;
				}
				return;
			}
			if (usesPrimaryModifier && !event.altKey && !event.shiftKey) {
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					decide("accepted");
				}
				return;
			}
			if (event.key === "Escape") {
				// Yield to an open menu or the error layer.
				if (menuOpen || state.error) return;
				event.preventDefault();
				event.stopPropagation();
				decide("rejected");
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [isActive, menuOpen, state.error, decide, navigate]);

	if (total === 0) return null;

	const activeDecision = state.decisions[state.activeIndex] ?? "pending";
	const counterLabel = `${state.activeIndex + 1} of ${total}`;

	return (
		<div
			className="markdown-review-stepper"
			data-testid="markdown-review-stepper"
			role="group"
			aria-label="Per-change review actions"
			data-applying={state.applying ? "true" : undefined}
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
									disabled={state.applying || state.activeIndex === 0}
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
									disabled={state.applying || state.activeIndex === total - 1}
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
									disabled={state.applying || pendingCount === 0}
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
							disabled={state.applying}
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
							disabled={state.applying}
							onClick={() => decide("accepted")}
						>
							<span>Accept</span>
							<kbd className="markdown-review-shortcut">
								{isMacPlatform() ? "⌘↩" : "Ctrl↩"}
							</kbd>
						</button>
					</div>

					{state.applying ? (
						<span className="markdown-review-applying" role="status">
							Applying…
						</span>
					) : null}
				</>
			)}
		</div>
	);
}

function highlightTargets(
	container: HTMLElement,
	change: {
		beforeBlockIds: readonly string[];
		afterBlockIds: readonly string[];
	},
): HTMLElement[] {
	const ids = new Set([...change.beforeBlockIds, ...change.afterBlockIds]);
	const targets: HTMLElement[] = [];
	for (const id of ids) {
		const escaped = cssEscape(id);
		const selector = `[data-diff-key="${escaped}"], [data-diff-key^="${escaped}:"]`;
		for (const element of container.querySelectorAll(selector)) {
			if (element instanceof HTMLElement && !targets.includes(element)) {
				targets.push(element);
			}
		}
	}
	return targets;
}

function revealIfNeeded(container: HTMLElement, target: HTMLElement): void {
	const containerRect = container.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	const fullyVisible =
		targetRect.top >= containerRect.top &&
		targetRect.bottom <= containerRect.bottom;
	if (fullyVisible) return;
	target.scrollIntoView({ block: "nearest", behavior: "auto" });
}

function cssEscape(value: string): string {
	const cssApi = (
		globalThis as { CSS?: { escape?: (value: string) => string } }
	).CSS;
	if (cssApi?.escape) return cssApi.escape(value);
	return value.replace(/["\\]/g, "\\$&");
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
