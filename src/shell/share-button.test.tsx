import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShareButton } from "./share-button";

beforeEach(() => {
	vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
		function (this: HTMLDialogElement) {
			this.setAttribute("open", "");
		},
	);
	vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
		this: HTMLDialogElement,
	) {
		this.removeAttribute("open");
	});
});

afterEach(() => {
	cleanup();
	delete window.flashtypeDesktop;
	vi.restoreAllMocks();
});
test("Share offers Lixray and an email draft without repository setup", () => {
	const openExternal = vi.fn().mockResolvedValue(undefined);
	window.flashtypeDesktop = { app: { openExternal } } as unknown as NonNullable<
		Window["flashtypeDesktop"]
	>;
	render(<ShareButton />);
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	expect(screen.getByRole("dialog")).toBeVisible();
	fireEvent.click(screen.getByRole("link", { name: /Open lixray.com/ }));
	expect(openExternal).toHaveBeenCalledWith({ url: "https://lixray.com/" });
	fireEvent.click(screen.getByRole("link", { name: /samuel@opral.com/ }));
	expect(openExternal).toHaveBeenCalledWith({
		url: "mailto:samuel@opral.com?subject=Flashtype%20sync%20request&body=Hi%20Samuel%2C%0A%0AI%E2%80%99m%20interested%20in%20syncing%20my%20local%20Flashtype%20files%20with%20Lixray.%20Please%20let%20me%20know%20when%20local%20sync%20is%20available.%0A%0AThanks%21",
	});
	expect(screen.queryByText("Initialize repository")).toBeNull();
});

test("Share dialog closes from the keyboard", () => {
	render(<ShareButton />);
	fireEvent.click(screen.getByRole("button", { name: "Share" }));
	const dialog = screen.getByRole("dialog");
	fireEvent.keyDown(dialog, { key: "Escape" });
	expect(dialog).not.toHaveAttribute("open");
});
