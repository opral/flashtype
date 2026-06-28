import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useReviewStepperShortcuts } from "./markdown-review-stepper-keyboard";

function Harness(props: {
	onAccept: () => void;
	onReject: () => void;
	onNavigate: (direction: -1 | 1) => void;
}) {
	useReviewStepperShortcuts({
		active: true,
		rejectBlocked: false,
		onAccept: props.onAccept,
		onReject: props.onReject,
		onNavigate: props.onNavigate,
	});
	return null;
}

function pressEscape() {
	act(() => {
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
	});
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("useReviewStepperShortcuts", () => {
	test("Escape rejects the active change when no modal is open", () => {
		const onReject = vi.fn();
		render(
			<Harness onAccept={vi.fn()} onReject={onReject} onNavigate={vi.fn()} />,
		);
		pressEscape();
		expect(onReject).toHaveBeenCalledTimes(1);
	});

	test("shortcuts yield to an open modal so the dialog owns Escape", () => {
		const onReject = vi.fn();
		const modal = document.createElement("div");
		modal.setAttribute("aria-modal", "true");
		document.body.appendChild(modal);

		render(
			<Harness onAccept={vi.fn()} onReject={onReject} onNavigate={vi.fn()} />,
		);
		pressEscape();
		// The stepper must not reject while the abandon dialog is up.
		expect(onReject).not.toHaveBeenCalled();
	});
});
