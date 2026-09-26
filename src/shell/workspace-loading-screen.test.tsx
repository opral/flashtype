import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { WorkspaceLoadingScreen } from "./workspace-loading-screen";
vi.mock("./top-bar", () => ({ TopBar: () => null }));
vi.mock("@/components/animated-zap", () => ({ AnimatedZap: () => null }));
const original = window.flashtypeDesktop;
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	window.flashtypeDesktop = original;
});
test("offers recovery after 30 seconds, deletes only on explicit click", async () => {
	vi.useFakeTimers();
	const recover = vi.fn().mockResolvedValue(undefined);
	window.flashtypeDesktop = {
		workspace: { deleteLixAndRestart: recover },
	} as unknown as NonNullable<typeof window.flashtypeDesktop>;
	render(
		<WorkspaceLoadingScreen
			workspaceName="Downloads"
			workspacePath="/Downloads"
		/>,
	);
	act(() => vi.advanceTimersByTime(29_999));
	expect(screen.queryByRole("button")).toBeNull();
	act(() => vi.advanceTimersByTime(1));
	expect(recover).not.toHaveBeenCalled();
	expect(
		screen.getByText(/permanently removes its change history/),
	).toBeInTheDocument();
	await act(async () =>
		fireEvent.click(
			screen.getByRole("button", { name: "Delete .lix and restart" }),
		),
	);
	expect(recover).toHaveBeenCalledWith("/Downloads");
	expect(screen.getByRole("button")).toBeDisabled();
});
test("resets timeout when folders change and clears timer on unmount", () => {
	vi.useFakeTimers();
	const view = render(
		<WorkspaceLoadingScreen workspaceName="A" workspacePath="/A" />,
	);
	act(() => vi.advanceTimersByTime(29_000));
	view.rerender(
		<WorkspaceLoadingScreen workspaceName="B" workspacePath="/B" />,
	);
	act(() => vi.advanceTimersByTime(1_000));
	expect(screen.queryByRole("button")).toBeNull();
	view.unmount();
	expect(vi.getTimerCount()).toBe(0);
});
test("does not offer deletion for temporary workspaces", () => {
	vi.useFakeTimers();
	render(<WorkspaceLoadingScreen workspaceName="Downloads" />);
	act(() => vi.advanceTimersByTime(30_000));
	expect(screen.queryByRole("button")).toBeNull();
});
test("reports recovery failures and allows retry", async () => {
	vi.useFakeTimers();
	window.flashtypeDesktop = {
		workspace: {
			deleteLixAndRestart: vi
				.fn()
				.mockRejectedValue(new Error("Disk unavailable")),
		},
	} as unknown as NonNullable<typeof window.flashtypeDesktop>;
	render(
		<WorkspaceLoadingScreen
			workspaceName="Downloads"
			workspacePath="/Downloads"
		/>,
	);
	act(() => vi.advanceTimersByTime(30_000));
	await act(async () => fireEvent.click(screen.getByRole("button")));
	expect(screen.getByRole("alert")).toHaveTextContent("Disk unavailable");
	expect(screen.getByRole("button")).toBeEnabled();
});
