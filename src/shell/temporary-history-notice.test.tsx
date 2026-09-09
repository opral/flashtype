import { afterEach, expect, test, vi } from "vitest";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { TemporaryHistoryNotice } from "./temporary-history-notice";
const original = window.flashtypeDesktop;
afterEach(() => {
	cleanup();
	window.flashtypeDesktop = original;
});
function desktop(inspectRepositorySize: ReturnType<typeof vi.fn>) {
	const initializeRepository = vi.fn().mockResolvedValue({});
	window.flashtypeDesktop = {
		workspace: { inspectRepositorySize, initializeRepository },
	} as unknown as NonNullable<typeof window.flashtypeDesktop>;
	return initializeRepository;
}
test("shows limits and blocks initialization until inspection succeeds", async () => {
	let finish!: (value: unknown) => void;
	const init = desktop(
		vi.fn(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		),
	);
	render(<TemporaryHistoryNotice />);
	const button = screen.getByRole("button", { name: "Initialize repository" });
	expect(button).toBeDisabled();
	expect(
		screen.getByText(/1 GB total, with no file-count limit/),
	).toBeInTheDocument();
	finish({
		fileCount: 200,
		totalBytes: 1_000_000_000,
		complete: true,
		allowed: true,
	});
	await waitFor(() => expect(button).toBeEnabled());
	fireEvent.click(button);
	await waitFor(() => expect(init).toHaveBeenCalledOnce());
});
test("explains oversized folders and allows checking again after files are removed", async () => {
	const inspect = vi
		.fn()
		.mockResolvedValueOnce({
			fileCount: 201,
			totalBytes: 1_000_000_001,
			complete: false,
			allowed: false,
		})
		.mockResolvedValueOnce({
			fileCount: 5,
			totalBytes: 12,
			complete: true,
			allowed: true,
		});
	const init = desktop(inspect);
	render(<TemporaryHistoryNotice />);
	expect(
		await screen.findByText(/exceeds the repository limit/),
	).toBeInTheDocument();
	const button = screen.getByRole("button", { name: "Initialize repository" });
	expect(button).toBeDisabled();
	fireEvent.click(button);
	expect(init).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Check again" }));
	await waitFor(() => expect(button).toBeEnabled());
});
test("fails closed and explains inspection errors", async () => {
	desktop(vi.fn().mockRejectedValue(new Error("EACCES")));
	render(<TemporaryHistoryNotice />);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Could not check this folder",
	);
	expect(
		screen.getByRole("button", { name: "Initialize repository" }),
	).toBeDisabled();
});

test("explains when the desktop process needs a restart", async () => {
	desktop(
		vi
			.fn()
			.mockRejectedValue(
				new Error(
					"No handler registered for 'workspace:inspectRepositorySize'",
				),
			),
	);
	render(<TemporaryHistoryNotice />);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Restart Flashtype",
	);
	expect(
		screen.getByRole("button", { name: "Initialize repository" }),
	).toBeDisabled();
});
