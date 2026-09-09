import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
	render,
	fireEvent,
	screen,
	waitFor,
	cleanup,
} from "@testing-library/react";
import { createMemorySessionStateStore } from "@opral/atelier/state-adapters";
import { ShareButton } from "./share-button";

const state = {
	focusedPanel: "central" as const,
	panels: {
		left: { views: [], activeInstance: null },
		right: { views: [], activeInstance: null },
		central: {
			views: [
				{
					instance: "file",
					kind: "markdown",
					state: { fileId: "file-id", filePath: "/notes/a.md" },
				},
			],
			activeInstance: "file",
		},
	},
};
const workspace = { path: "/workspace", name: "Notes" };
let api: NonNullable<Window["flashtypeDesktop"]>["share"];
beforeEach(() => {
	sessionStorage.clear();
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute("open");
	};
	api = {
		setToken: vi.fn().mockResolvedValue(undefined),
		status: vi.fn().mockResolvedValue({ hasToken: true, connected: false }),
		connect: vi.fn().mockResolvedValue({ reload: true }),
		reconnect: vi.fn().mockResolvedValue(undefined),
		publish: vi.fn().mockResolvedValue({
			published: true,
			inherited: false,
			url: "https://lixray.test/shared-file",
		}),
	};
	window.flashtypeDesktop = { share: api } as NonNullable<
		Window["flashtypeDesktop"]
	>;
});
afterEach(() => {
	cleanup();
	delete window.flashtypeDesktop;
});
test("private upload consent survives reconnect and publishes only the selected file", async () => {
	const store = createMemorySessionStateStore(state);
	const view = render(<ShareButton store={store} workspace={workspace} />);
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	const connect = await screen.findByRole("button", {
		name: "Sync privately and publish file",
	});
	await waitFor(() => expect(connect).not.toBeDisabled());
	expect(
		screen.getByText(/whole Notes repository, including its history/),
	).toBeTruthy();
	fireEvent.click(connect);
	await waitFor(() => expect(api.reconnect).toHaveBeenCalledOnce());
	expect(api.connect).toHaveBeenCalledWith(true);
	expect(api.publish).not.toHaveBeenCalled();
	view.unmount();
	vi.mocked(api.status).mockResolvedValue({ hasToken: true, connected: true });
	render(<ShareButton store={store} workspace={workspace} />);
	await waitFor(() =>
		expect(api.publish).toHaveBeenCalledWith("/notes/a.md", true),
	);
	expect(
		await screen.findByDisplayValue("https://lixray.test/shared-file"),
	).toBeTruthy();
});
test("no file selected disables sharing", () => {
	render(
		<ShareButton
			store={createMemorySessionStateStore()}
			workspace={workspace}
		/>,
	);
	expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
});

test("replacing a revoked token reconnects after the initial status request failed", async () => {
	vi.mocked(api.status).mockRejectedValueOnce(new Error("Token revoked"));
	render(
		<ShareButton
			store={createMemorySessionStateStore(state)}
			workspace={workspace}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	await screen.findByText("Token revoked");
	fireEvent.change(screen.getByLabelText("API token", { exact: true }), {
		target: { value: "replacement" },
	});
	vi.mocked(api.status).mockResolvedValue({ hasToken: true, connected: true });
	fireEvent.click(screen.getByRole("button", { name: "Save token" }));
	await waitFor(() => expect(api.reconnect).toHaveBeenCalledOnce());
	expect(api.setToken).toHaveBeenCalledWith("replacement");
});
