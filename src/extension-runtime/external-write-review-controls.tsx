import { useEffect } from "react";
import "./external-write-review-controls.css";

type ExternalWriteReviewControlsProps = {
	readonly isActive: boolean;
	readonly onAccept?: () => void;
	readonly onReject?: () => void;
};

export function ExternalWriteReviewControls({
	isActive,
	onAccept,
	onReject,
}: ExternalWriteReviewControlsProps) {
	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				onReject?.();
				return;
			}
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (!usesPrimaryModifier) return;
			if (event.altKey || event.shiftKey) return;
			if (event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				onAccept?.();
				return;
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				event.preventDefault();
				event.stopPropagation();
				onReject?.();
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [isActive, onAccept, onReject]);

	return (
		<div
			className="external-write-review-actions"
			role="group"
			aria-label="External write review actions"
		>
			<button
				type="button"
				className="external-write-review-button external-write-review-button-reject"
				onClick={onReject}
			>
				<span>Undo</span>
				<kbd className="external-write-review-shortcut external-write-review-shortcut-dark">
					Esc
				</kbd>
			</button>
			<button
				type="button"
				className="external-write-review-button external-write-review-button-accept"
				onClick={onAccept}
			>
				<span>Keep</span>
				<kbd className="external-write-review-shortcut">
					{isMacPlatform() ? "⌘↩" : "Ctrl↩"}
				</kbd>
			</button>
		</div>
	);
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
