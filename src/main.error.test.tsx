import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ErrorFallback } from "./main.error";
vi.mock("./lib/telemetry", () => ({ captureTelemetryException: vi.fn() }));
vi.mock("./lib/workspace-recovery-telemetry", () => ({
	captureWorkspaceRecoveryLifecycle: vi.fn(),
}));
afterEach(() => {
	cleanup();
	delete window.flashtypeDesktop;
});
test("older repository format offers upgrade guidance instead of history deletion", async () => {
	window.flashtypeDesktop = {
		workspace: { get: async () => ({ path: "/old", ephemeral: false }) },
	} as unknown as NonNullable<Window["flashtypeDesktop"]>;
	render(
		<ErrorFallback
			error={
				new Error(
					"repository format v78 must be upgraded to v81 using the detached migration tool before opening it",
				)
			}
		/>,
	);
	await waitFor(() =>
		expect(
			screen.getByRole("heading", { name: "Repository upgrade required" }),
		).toBeVisible(),
	);
	expect(
		screen.queryByRole("button", { name: "Delete .lix and restart" }),
	).toBeNull();
});
test("temporary repository query errors cannot offer deletion of nonexistent history", async () => {
	window.flashtypeDesktop = {
		workspace: { get: async () => ({ path: "/temporary", ephemeral: true }) },
	} as unknown as NonNullable<Window["flashtypeDesktop"]>;
	render(<ErrorFallback error={new Error("No field named row_count")} />);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Try again" })).toBeVisible(),
	);
	expect(
		screen.queryByRole("button", { name: "Delete .lix and restart" }),
	).toBeNull();
});
