import { useEffect } from "react";

/**
 * Scoped keyboard shortcuts for the review stepper, active only while this
 * review owns the surface: Cmd/Ctrl+Enter accepts, Alt+Up/Down navigates, and
 * Escape rejects. Escape is suppressed while `rejectBlocked` is set (e.g. a
 * dropdown or the error layer owns the key).
 */
export function useReviewStepperShortcuts({
	active,
	rejectBlocked,
	onAccept,
	onReject,
	onNavigate,
}: {
	active: boolean;
	rejectBlocked: boolean;
	onAccept: () => void;
	onReject: () => void;
	onNavigate: (direction: -1 | 1) => void;
}): void {
	useEffect(() => {
		if (!active) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (event.altKey && !event.metaKey && !event.ctrlKey) {
				if (event.key === "ArrowUp") {
					event.preventDefault();
					event.stopPropagation();
					onNavigate(-1);
					return;
				}
				if (event.key === "ArrowDown") {
					event.preventDefault();
					event.stopPropagation();
					onNavigate(1);
				}
				return;
			}
			if (usesPrimaryModifier && !event.altKey && !event.shiftKey) {
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					onAccept();
				}
				return;
			}
			if (event.key === "Escape") {
				if (rejectBlocked) return;
				event.preventDefault();
				event.stopPropagation();
				onReject();
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [active, rejectBlocked, onAccept, onReject, onNavigate]);
}
