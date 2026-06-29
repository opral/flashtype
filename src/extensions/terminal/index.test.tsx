import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DesktopTerminalApi } from "../../../electron/types";

const xtermMock = vi.hoisted(() => ({
	instances: [] as Array<{
		write: ReturnType<typeof vi.fn>;
		writeln: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("@xterm/xterm", () => {
	class MockTerminal {
		cols = 80;
		rows = 24;
		write = vi.fn();
		writeln = vi.fn();
		dispose = vi.fn();
		loadAddon = vi.fn();
		open = vi.fn();
		onData = vi.fn(() => ({ dispose: vi.fn() }));

		constructor() {
			xtermMock.instances.push(this);
		}
	}
	return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => {
	class MockFitAddon {
		fit = vi.fn();
	}
	return { FitAddon: MockFitAddon };
});

import { TerminalView } from "./index";

const originalDesktop = window.flashtypeDesktop;
const originalResizeObserver = window.ResizeObserver;

describe("TerminalView", () => {
	beforeEach(() => {
		xtermMock.instances.length = 0;
		window.ResizeObserver = class {
			observe = vi.fn();
			disconnect = vi.fn();
		} as unknown as typeof ResizeObserver;
	});

	afterEach(() => {
		window.flashtypeDesktop = originalDesktop;
		window.ResizeObserver = originalResizeObserver;
		vi.restoreAllMocks();
	});

	test("renders agent version errors as UI and retries the launch", async () => {
		const terminalApi = createTerminalApi();
		terminalApi.create = vi
			.fn()
			.mockResolvedValueOnce({
				status: "agentVersionError",
				agent: "claude",
				requiredVersion: "2.1.78",
				detectedVersion: "2.1.77",
				reason: "unsupported",
			})
			.mockResolvedValueOnce({ status: "created", id: "terminal:1" });
		window.flashtypeDesktop = {
			lix: {
				workspaceDir: vi.fn().mockResolvedValue("/workspace"),
			},
			terminal: terminalApi,
		} as unknown as Window["flashtypeDesktop"];

		render(
			<TerminalView
				launchConfig={{
					initialCommand: "claude-flashtype",
					pathWrapper: {
						executableName: "claude-flashtype",
						command: "claude --settings '{}'",
					},
				}}
			/>,
		);

		expect(
			await screen.findByText("Claude Code update required"),
		).toBeInTheDocument();
		expect(
			screen.getByText(/Flashtype needs Claude Code 2\.1\.78 or newer/u),
		).toBeInTheDocument();
		expect(xtermMock.instances[0]?.writeln).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: /retry/i }));

		await waitFor(() => expect(terminalApi.create).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(terminalApi.write).toHaveBeenCalledWith({
				id: "terminal:1",
				data: "claude-flashtype\r",
			}),
		);
	});
});

function createTerminalApi(): DesktopTerminalApi {
	return {
		create: vi.fn(),
		write: vi.fn().mockResolvedValue(undefined),
		resize: vi.fn().mockResolvedValue(undefined),
		kill: vi.fn().mockResolvedValue(undefined),
		onData: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
	};
}
