import { useCallback, useEffect, useRef } from "react";
import "./external-write-review-abandon-dialog.css";

export type ExternalWriteReviewAbandonDialogProps = {
	readonly open: boolean;
	/** Keep the review open and discard nothing. Also the Escape/backdrop action. */
	readonly onKeepReviewing: () => void;
	/** Abandon the buffer but keep the proposed (after) changes, then continue. */
	readonly onKeepProposed: () => void;
	/** Restore the original (before) content, then continue. */
	readonly onRejectAll: () => void;
};

/**
 * Accessible three-action confirmation shown when a destructive action would
 * discard a partially-decided Markdown review. "Keep reviewing" is the primary
 * action, takes initial focus, and is the meaning of Escape and a backdrop
 * click. Focus is restored to the previously focused element on close.
 */
export function ExternalWriteReviewAbandonDialog({
	open,
	onKeepReviewing,
	onKeepProposed,
	onRejectAll,
}: ExternalWriteReviewAbandonDialogProps) {
	const keepReviewingRef = useRef<HTMLButtonElement | null>(null);
	const dialogRef = useRef<HTMLDivElement | null>(null);
	const previouslyFocusedRef = useRef<Element | null>(null);

	useEffect(() => {
		if (!open) return;
		previouslyFocusedRef.current = document.activeElement;
		keepReviewingRef.current?.focus();
		return () => {
			const previous = previouslyFocusedRef.current;
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, [open]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onKeepReviewing();
				return;
			}
			if (event.key !== "Tab") return;
			// Minimal focus trap across the three actions.
			const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
				"button:not([disabled])",
			);
			if (!focusable || focusable.length === 0) return;
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			const active = document.activeElement;
			if (event.shiftKey && active === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		},
		[onKeepReviewing],
	);

	if (!open) return null;

	return (
		<div
			className="external-write-review-abandon-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onKeepReviewing();
			}}
		>
			<div
				ref={dialogRef}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="external-write-review-abandon-title"
				aria-describedby="external-write-review-abandon-description"
				className="external-write-review-abandon-dialog"
				onKeyDown={handleKeyDown}
			>
				<h2
					id="external-write-review-abandon-title"
					className="external-write-review-abandon-title"
				>
					Discard review decisions?
				</h2>
				<p
					id="external-write-review-abandon-description"
					className="external-write-review-abandon-description"
				>
					You have decisions in progress for this review. Choose what to do with
					them before leaving.
				</p>
				<div className="external-write-review-abandon-actions">
					<button
						type="button"
						ref={keepReviewingRef}
						className="external-write-review-abandon-button external-write-review-abandon-button-primary"
						onClick={onKeepReviewing}
					>
						Keep reviewing
					</button>
					<button
						type="button"
						className="external-write-review-abandon-button"
						onClick={onKeepProposed}
					>
						Keep proposed changes
					</button>
					<button
						type="button"
						className="external-write-review-abandon-button"
						onClick={onRejectAll}
					>
						Reject all changes
					</button>
				</div>
			</div>
		</div>
	);
}
