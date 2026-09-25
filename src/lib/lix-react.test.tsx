import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { LixProvider, useQuery } from "./lix-react";
import type { Lix, ObserveEvent } from "./lix-types";

afterEach(() => {
	vi.restoreAllMocks();
});

test("useQuery applies the first observe snapshot over the initial read", async () => {
	let resolveFirstObserve:
		| ((event: IteratorResult<ObserveEvent>) => void)
		| undefined;
	const next = vi
		.fn()
		.mockImplementationOnce(
			() =>
				new Promise<IteratorResult<ObserveEvent>>((resolve) => {
					resolveFirstObserve = resolve;
				}),
		)
		.mockImplementation(
			() => new Promise<IteratorResult<ObserveEvent>>(() => {}),
		);
	const returnIterator = vi.fn(async () => ({ done: true, value: undefined }));
	const lix = {
		observe: vi.fn(() => ({
			next,
			return: returnIterator,
			[Symbol.asyncIterator]() {
				return this;
			},
		})),
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
		done: false,
		value: {
			sequence: 1,
			mutationSequence: 1,
			result: {
				columns: [{ name: "value", type: "jsonb" }],
				rows: [
					{
						value: "fresh",
					},
				] as unknown as ObserveEvent["result"]["rows"],
				rowsAffected: 0,
				notices: [],
				commit: null,
			},
		},
	});

	await waitFor(() => {
		expect(screen.getByTestId("value")).toHaveTextContent("fresh");
	});
});
