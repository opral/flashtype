import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ExternalWriteReviewAbandonDialog } from "./external-write-review-abandon-dialog";

function setup(open = true) {
	const onKeepReviewing = vi.fn();
	const onKeepProposed = vi.fn();
	const onRejectAll = vi.fn();
	const utils = render(
		<ExternalWriteReviewAbandonDialog
			open={open}
			onKeepReviewing={onKeepReviewing}
			onKeepProposed={onKeepProposed}
			onRejectAll={onRejectAll}
		/>,
	);
	return { ...utils, onKeepReviewing, onKeepProposed, onRejectAll };
}

describe("ExternalWriteReviewAbandonDialog", () => {
	test("renders nothing when closed", () => {
		setup(false);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	test("is an accessible alertdialog titled for discarding decisions", () => {
		setup();
		const dialog = screen.getByRole("alertdialog");
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(screen.getByText("Discard review decisions?")).toBeTruthy();
	});

	test("focuses Keep reviewing on open", () => {
		setup();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Keep reviewing" }),
		);
	});

	test("each action invokes its callback", () => {
		const { onKeepReviewing, onKeepProposed, onRejectAll } = setup();
		fireEvent.click(screen.getByRole("button", { name: "Keep reviewing" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Keep proposed changes" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Reject all changes" }));
		expect(onKeepReviewing).toHaveBeenCalledTimes(1);
		expect(onKeepProposed).toHaveBeenCalledTimes(1);
		expect(onRejectAll).toHaveBeenCalledTimes(1);
	});

	test("Escape means Keep reviewing", () => {
		const { onKeepReviewing, onKeepProposed, onRejectAll } = setup();
		fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
		expect(onKeepReviewing).toHaveBeenCalledTimes(1);
		expect(onKeepProposed).not.toHaveBeenCalled();
		expect(onRejectAll).not.toHaveBeenCalled();
	});

	test("clicking the backdrop means Keep reviewing", () => {
		const { onKeepReviewing } = setup();
		const backdrop = screen.getByRole("alertdialog")
			.parentElement as HTMLElement;
		fireEvent.mouseDown(backdrop);
		expect(onKeepReviewing).toHaveBeenCalledTimes(1);
	});

	test("restores focus to the previously focused element on close", () => {
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		const onKeepReviewing = vi.fn();
		const { rerender } = render(
			<ExternalWriteReviewAbandonDialog
				open
				onKeepReviewing={onKeepReviewing}
				onKeepProposed={() => {}}
				onRejectAll={() => {}}
			/>,
		);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Keep reviewing" }),
		);
		act(() => {
			rerender(
				<ExternalWriteReviewAbandonDialog
					open={false}
					onKeepReviewing={onKeepReviewing}
					onKeepProposed={() => {}}
					onRejectAll={() => {}}
				/>,
			);
		});
		expect(document.activeElement).toBe(trigger);
		trigger.remove();
	});
});
