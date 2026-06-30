import { Suspense } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LixProvider, useQuery } from "./lix-react";
import type { Lix, ObserveEvent } from "./lix-types";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

test("useQuery applies the first observe snapshot over the initial read", async () => {
	let resolveFirstObserve:
		| ((event: ObserveEvent | undefined) => void)
		| undefined;
	const next = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<ObserveEvent | undefined>((resolve) => {
					resolveFirstObserve = resolve;
				}),
		)
		.mockImplementation(() => new Promise<ObserveEvent | undefined>(() => {}));
	const close = vi.fn();
	const lix = {
		observe: vi.fn(() => ({ next, close })),
	} as unknown as Lix;
	const execute = vi.fn(async () => [{ value: "stale" }]);

	function Probe() {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM observe_race_regression",
				parameters: [],
			}),
			execute,
		}));
		return <div data-testid="value">{rows[0]?.value}</div>;
	}

	await act(async () => {
		render(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="loading" />}>
					<Probe />
				</Suspense>
			</LixProvider>,
		);
	});

	await expect(screen.findByTestId("value")).resolves.toHaveTextContent(
		"stale",
	);

	resolveFirstObserve?.({
		sequence: 1,
		mutationSequence: 1,
		result: {
			columns: ["value"],
			rows: [
				{
					toObject: () => ({ value: "fresh" }),
				},
			] as unknown as ObserveEvent["result"]["rows"],
			rowsAffected: 0,
			notices: [],
		},
	});

	await waitFor(() => {
		expect(screen.getByTestId("value")).toHaveTextContent("fresh");
	});
});

test("useQuery shares one observe stream between identical subscribers", async () => {
	let resolveNext: ((event: ObserveEvent | undefined) => void) | undefined;
	const next = vi.fn(
		() =>
			new Promise<ObserveEvent | undefined>((resolve) => {
				resolveNext = resolve;
			}),
	);
	const close = vi.fn();
	const lix = {
		observe: vi.fn(() => ({ next, close })),
	} as unknown as Lix;
	const execute = vi.fn(async () => [{ value: "initial" }]);

	function Probe({ testId }: { readonly testId: string }) {
		const rows = useQuery<{ value: string }>(() => ({
			compile: () => ({
				sql: "SELECT value FROM shared_observe_subscription",
				parameters: ["same"],
			}),
			execute,
		}));
		return <div data-testid={testId}>{rows[0]?.value}</div>;
	}

	let view: ReturnType<typeof render>;
	await act(async () => {
		view = render(
			<LixProvider lix={lix}>
				<Suspense fallback={<div data-testid="loading" />}>
					<Probe testId="first" />
					<Probe testId="second" />
				</Suspense>
			</LixProvider>,
		);
	});

	await expect(screen.findByTestId("first")).resolves.toHaveTextContent(
		"initial",
	);
	expect(screen.getByTestId("second")).toHaveTextContent("initial");
	await waitFor(() => {
		expect(lix.observe).toHaveBeenCalledTimes(1);
	});
	expect(execute).toHaveBeenCalledTimes(1);

	await act(async () => {
		resolveNext?.(observeEvent({ value: "fresh" }));
	});

	await waitFor(() => {
		expect(screen.getByTestId("first")).toHaveTextContent("fresh");
		expect(screen.getByTestId("second")).toHaveTextContent("fresh");
	});

	view!.unmount();
	expect(close).toHaveBeenCalledTimes(1);
});

function observeEvent(row: Record<string, unknown>): ObserveEvent {
	return {
		sequence: 1,
		mutationSequence: 1,
		result: {
			columns: Object.keys(row),
			rows: [
				{
					toObject: () => row,
				},
			] as unknown as ObserveEvent["result"]["rows"],
			rowsAffected: 0,
			notices: [],
		},
	};
}
