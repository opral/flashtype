import { createRef } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

// Radix menus rely on Pointer Capture and scrollIntoView, which happy-dom does
// not implement. Polyfill them so the dropdown can open in tests.
beforeAll(() => {
	const proto = window.HTMLElement.prototype as unknown as Record<
		string,
		unknown
	>;
	proto.hasPointerCapture = () => false;
	proto.setPointerCapture = () => {};
	proto.releasePointerCapture = () => {};
	proto.scrollIntoView = () => {};
});
import type { MarkdownBlockSnapshot } from "./review-diff";
import { renderMarkdownProjection } from "./granular-review-projection";
import {
	planGranularReview,
	type GranularReviewPlan,
} from "./granular-review-plan";
import { MarkdownReviewStepper } from "./markdown-review-stepper";
import type {
	GranularReviewResolution,
	GranularReviewResolutionOutcome,
} from "@/extension-runtime/external-write-review";

const b = (
	id: string,
	orderKey: string,
	block: string,
): MarkdownBlockSnapshot => ({
	id,
	orderKey,
	block,
});

const TWO_CHANGE_BEFORE = [
	b("a", "20", "Alpha"),
	b("m", "40", "Middle"),
	b("z", "60", "Zeta"),
];
const TWO_CHANGE_AFTER = [
	b("a", "20", "Alpha edited"),
	b("m", "40", "Middle"),
	b("z", "60", "Zeta edited"),
];

function buildPlan(
	before = TWO_CHANGE_BEFORE,
	after = TWO_CHANGE_AFTER,
): { plan: GranularReviewPlan; beforeData: Uint8Array; afterData: Uint8Array } {
	const beforeData = renderMarkdownProjection(before);
	const afterData = renderMarkdownProjection(after);
	const eligibility = planGranularReview({
		beforeBlocks: before,
		afterBlocks: after,
		beforeData,
		afterData,
	});
	if (eligibility.status !== "safe") throw new Error("expected safe plan");
	return { plan: eligibility.plan, beforeData, afterData };
}

function renderStepper(options?: {
	onResolve?: (...args: any[]) => Promise<GranularReviewResolutionOutcome>;
	isActive?: boolean;
}) {
	const { plan, beforeData, afterData } = buildPlan();
	const onResolve = vi.fn(
		options?.onResolve ?? (async () => "applied" as const),
	);
	const ref = createRef<HTMLElement>();
	const utils = render(
		<MarkdownReviewStepper
			plan={plan}
			reviewId="review-1"
			fileId="file-1"
			beforeData={beforeData}
			afterData={afterData}
			isActive={options?.isActive ?? true}
			diffContainerRef={ref}
			onResolve={onResolve}
		/>,
	);
	return { ...utils, onResolve, beforeData, afterData };
}

describe("MarkdownReviewStepper", () => {
	test("renders the counter and an atomic live region", () => {
		renderStepper();
		expect(screen.getByText("1 of 2")).toBeTruthy();
		expect(screen.getByText("Change 1 of 2")).toBeTruthy();
	});

	test("accepting every change auto-applies with the exact after-state", async () => {
		const { onResolve, afterData } = renderStepper();
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		expect(screen.getByText("2 of 2")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
		const resolution = onResolve.mock.calls[0]![0];
		expect(resolution.acceptedCount).toBe(2);
		expect(resolution.rejectedCount).toBe(0);
		expect(resolution.usedRemainingAction).toBe(false);
		expect(Array.from(resolution.resolvedData)).toEqual(Array.from(afterData));
	});

	test("a mixed accept/reject composes a canonical projection", async () => {
		const { onResolve } = renderStepper();
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
		const resolution = onResolve.mock.calls[0]![0];
		expect(resolution.acceptedCount).toBe(1);
		expect(resolution.rejectedCount).toBe(1);
		expect(new TextDecoder().decode(resolution.resolvedData)).toBe(
			"Alpha edited\n\nMiddle\n\nZeta\n",
		);
	});

	test("Accept remaining preserves prior decisions and flags the bulk action", async () => {
		const { onResolve } = renderStepper();
		fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
		const trigger = screen.getByRole("button", {
			name: "More review actions",
		});
		fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
		fireEvent.pointerUp(trigger, { button: 0, pointerType: "mouse" });
		fireEvent.click(await screen.findByText("Accept 1 remaining"));
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
		const resolution = onResolve.mock.calls[0]![0];
		expect(resolution.acceptedCount).toBe(1);
		expect(resolution.rejectedCount).toBe(1);
		expect(resolution.usedRemainingAction).toBe(true);
	});

	test("Cmd/Ctrl+Enter accepts and Escape rejects the current change", async () => {
		const { onResolve } = renderStepper();
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
			);
		});
		expect(screen.getByText("2 of 2")).toBeTruthy();
		act(() => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		});
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
		const resolution = onResolve.mock.calls[0]![0];
		expect(resolution.acceptedCount).toBe(1);
		expect(resolution.rejectedCount).toBe(1);
	});

	test("Option/Alt+Up and Down navigate without deciding", () => {
		renderStepper();
		expect(screen.getByText("1 of 2")).toBeTruthy();
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true }),
			);
		});
		expect(screen.getByText("2 of 2")).toBeTruthy();
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true }),
			);
		});
		expect(screen.getByText("1 of 2")).toBeTruthy();
	});

	test("bare arrow keys are not captured by the stepper", () => {
		renderStepper();
		const event = new KeyboardEvent("keydown", {
			key: "ArrowDown",
			cancelable: true,
		});
		act(() => {
			window.dispatchEvent(event);
		});
		expect(event.defaultPrevented).toBe(false);
		expect(screen.getByText("1 of 2")).toBeTruthy();
	});

	test("does not handle shortcuts when inactive", () => {
		const { onResolve } = renderStepper({ isActive: false });
		act(() => {
			window.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", metaKey: true }),
			);
		});
		expect(screen.getByText("1 of 2")).toBeTruthy();
		expect(onResolve).not.toHaveBeenCalled();
	});

	test("disables controls immediately on submit, before the Applying affordance", () => {
		// A resolution that never settles keeps the stepper in its submitting state.
		const onResolveImpl = vi.fn(
			() => new Promise<GranularReviewResolutionOutcome>(() => {}),
		);
		const { onResolve } = renderStepper({ onResolve: onResolveImpl as any });
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		// The write is in flight: controls are disabled synchronously, without
		// waiting for the delayed "Applying…" affordance.
		expect(onResolve).toHaveBeenCalledTimes(1);
		const accept = screen.getByRole("button", {
			name: /Accept/,
		}) as HTMLButtonElement;
		const reject = screen.getByRole("button", {
			name: /Reject/,
		}) as HTMLButtonElement;
		expect(accept.disabled).toBe(true);
		expect(reject.disabled).toBe(true);
		// "Applying…" is delayed, so it has not flashed in for this fast path.
		expect(screen.queryByText("Applying…")).toBeNull();
	});

	test("carries prior decisions when a later write folds into the review", async () => {
		// Same baseline (before-anchor) for both plans; the second adds a change.
		const baseline = [b("h", "10", "# T"), b("p", "20", "Alpha"), b("q", "30", "Beta")];
		const v1 = [b("h", "10", "# T"), b("p", "20", "Alpha v2"), b("q", "30", "Beta v2")];
		const v2 = [
			b("h", "10", "# T"),
			b("p", "20", "Alpha v2"),
			b("q", "30", "Beta v2"),
			b("r", "40", "Gamma"),
		];
		const first = buildPlan(baseline, v1);
		const second = buildPlan(baseline, v2);
		expect(first.plan.changes).toHaveLength(2);
		expect(second.plan.changes).toHaveLength(3);

		const ref = createRef<HTMLElement>();
		const onResolve = vi.fn<
			(r: GranularReviewResolution) => Promise<GranularReviewResolutionOutcome>
		>(async () => "applied");
		const propsFor = (
			built: typeof first,
			reviewId: string,
		): React.ComponentProps<typeof MarkdownReviewStepper> => ({
			plan: built.plan,
			reviewId,
			fileId: "file-1",
			beforeData: built.beforeData,
			afterData: built.afterData,
			isActive: true,
			diffContainerRef: ref,
			onResolve,
		});

		const { rerender } = render(
			<MarkdownReviewStepper {...propsFor(first, "review-v1")} />,
		);
		// Accept the first change, leaving the second pending.
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		expect(screen.getByText("2 of 2")).toBeTruthy();

		// A sequential write folds in: same before-anchor, new reviewId, 3 changes.
		rerender(<MarkdownReviewStepper {...propsFor(second, "review-v2")} />);

		// The first change stays accepted, so deciding only the two pending ones
		// completes the cumulative review. If the decision had been reset, two
		// clicks would leave one change pending and never resolve.
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
		expect(onResolve.mock.calls[0]![0].acceptedCount).toBe(3);
		expect(onResolve.mock.calls[0]![0].rejectedCount).toBe(0);
	});

	test("re-prompts a decided change whose content evolves in a later write", async () => {
		// Same key for the first change across both plans, but its after-content
		// changes (Alpha v2 -> Alpha v3), so the carried decision must NOT be reused.
		const baseline = [b("h", "10", "# T"), b("p", "20", "Alpha"), b("q", "30", "Beta")];
		const v1 = [b("h", "10", "# T"), b("p", "20", "Alpha v2"), b("q", "30", "Beta v2")];
		const v2 = [b("h", "10", "# T"), b("p", "20", "Alpha v3"), b("q", "30", "Beta v2")];
		const first = buildPlan(baseline, v1);
		const second = buildPlan(baseline, v2);

		const ref = createRef<HTMLElement>();
		const onResolve = vi.fn<
			(r: GranularReviewResolution) => Promise<GranularReviewResolutionOutcome>
		>(async () => "applied");
		const propsFor = (
			built: typeof first,
			reviewId: string,
		): React.ComponentProps<typeof MarkdownReviewStepper> => ({
			plan: built.plan,
			reviewId,
			fileId: "file-1",
			beforeData: built.beforeData,
			afterData: built.afterData,
			isActive: true,
			diffContainerRef: ref,
			onResolve,
		});

		const { rerender } = render(
			<MarkdownReviewStepper {...propsFor(first, "review-v1")} />,
		);
		// Accept the first change (p), leaving the second (q) pending.
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		expect(screen.getByText("2 of 2")).toBeTruthy();

		// Fold: same before-anchor, but p's content evolved -> its decision resets.
		rerender(<MarkdownReviewStepper {...propsFor(second, "review-v2")} />);

		// Both changes are pending now: a single decision must NOT complete the
		// review (if p's accept had been carried, one click would have resolved).
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		expect(onResolve).not.toHaveBeenCalled();
		// Deciding the remaining change completes it.
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(1));
		expect(onResolve.mock.calls[0]![0].acceptedCount).toBe(2);
	});

	test("a failed resolution keeps decisions and offers Retry", async () => {
		const onResolveImpl = vi
			.fn<() => Promise<GranularReviewResolutionOutcome>>()
			.mockResolvedValueOnce("failed")
			.mockResolvedValueOnce("applied");
		const { onResolve } = renderStepper({ onResolve: onResolveImpl as any });
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
		const retry = await screen.findByRole("button", { name: "Retry" });
		expect(screen.getByRole("alert").textContent).toContain(
			"Couldn’t apply review",
		);
		fireEvent.click(retry);
		await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(2));
	});
});
