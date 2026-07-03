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
const telemetryMock = vi.hoisted(() => ({
	captureTelemetry: vi.fn(),
	captureTelemetryException: vi.fn(),
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

vi.mock("@/lib/telemetry", () => telemetryMock);

import { TerminalView } from "./index";

const originalDesktop = window.flashtypeDesktop;
const originalResizeObserver = window.ResizeObserver;

describe("TerminalView", () => {
	beforeEach(() => {
		xtermMock.instances.length = 0;
		telemetryMock.captureTelemetry.mockClear();
		telemetryMock.captureTelemetryException.mockClear();
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
		expect(telemetryMock.captureTelemetry).toHaveBeenCalledWith(
			"agent_start_failed",
			{
				agent: "claude",
				reason: "unsupported",
				required_version: "2.1.78",
				detected_version: "2.1.77",
				surface: "terminal",
				retry_count: 0,
			},
		);
		expect(telemetryMock.captureTelemetryException).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: /retry/i }));

		await waitFor(() => expect(terminalApi.create).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(terminalApi.write).toHaveBeenCalledWith({
				id: "terminal:1",
				data: "claude-flashtype\r",
			}),
		);
	});

	test.each([
		["missing", "Claude Code not found"],
		["unparseable", "Could not read Claude Code version"],
		["timeout", "Claude Code version check timed out"],
		["failed", "Claude Code version check failed"],
	] as const)(
		"captures agent version startup telemetry for %s errors",
		async (reason, title) => {
			const terminalApi = createTerminalApi();
			terminalApi.create = vi.fn().mockResolvedValueOnce({
				status: "agentVersionError",
				agent: "claude",
				requiredVersion: "2.1.78",
				reason,
			});
			window.flashtypeDesktop = createDesktop(terminalApi);

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

			expect(await screen.findByText(title)).toBeInTheDocument();
			expect(telemetryMock.captureTelemetry).toHaveBeenCalledWith(
				"agent_start_failed",
				{
					agent: "claude",
					reason,
					required_version: "2.1.78",
					detected_version: undefined,
					surface: "terminal",
					retry_count: 0,
				},
			);
			expect(telemetryMock.captureTelemetryException).not.toHaveBeenCalled();
		},
	);

	test("captures retry count on later startup failures", async () => {
		const terminalApi = createTerminalApi();
		terminalApi.create = vi
			.fn()
			.mockResolvedValueOnce({
				status: "agentVersionError",
				agent: "codex",
				requiredVersion: "0.134.0",
				detectedVersion: "0.133.0",
				reason: "unsupported",
			})
			.mockResolvedValueOnce({
				status: "agentVersionError",
				agent: "codex",
				requiredVersion: "0.134.0",
				detectedVersion: "0.133.0",
				reason: "unsupported",
			});
		window.flashtypeDesktop = createDesktop(terminalApi);

		render(
			<TerminalView
				launchConfig={{
					initialCommand: "codex-flashtype",
					pathWrapper: {
						executableName: "codex-flashtype",
						command: "codex --dangerously-bypass-hook-trust",
					},
				}}
			/>,
		);

		expect(
			await screen.findByText("Codex update required"),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /retry/i }));

		await waitFor(() => expect(terminalApi.create).toHaveBeenCalledTimes(2));
		await waitFor(() =>
			expect(telemetryMock.captureTelemetry).toHaveBeenLastCalledWith(
				"agent_start_failed",
				{
					agent: "codex",
					reason: "unsupported",
					required_version: "0.134.0",
					detected_version: "0.133.0",
					surface: "terminal",
					retry_count: 1,
				},
			),
		);
	});

	test("captures unexpected agent startup errors as telemetry and exceptions", async () => {
		const terminalApi = createTerminalApi();
		const error = new Error("pty failed");
		terminalApi.create = vi.fn().mockRejectedValueOnce(error);
		window.flashtypeDesktop = createDesktop(terminalApi);

		render(
			<TerminalView
				launchConfig={{
					initialCommand: "codex-flashtype",
					pathWrapper: {
						executableName: "codex-flashtype",
						command: "codex --dangerously-bypass-hook-trust",
					},
				}}
			/>,
		);

		expect(
			await screen.findByText("Failed to start terminal"),
		).toBeInTheDocument();
		expect(telemetryMock.captureTelemetry).toHaveBeenCalledWith(
			"agent_start_failed",
			{
				agent: "codex",
				reason: "unexpected",
				surface: "terminal",
				retry_count: 0,
			},
		);
		expect(telemetryMock.captureTelemetryException).toHaveBeenCalledWith(
			error,
			{
				agent: "codex",
				reason: "unexpected",
				surface: "terminal",
				retry_count: 0,
			},
		);
	});

	test("captures initial command write failures as agent startup telemetry", async () => {
		const terminalApi = createTerminalApi();
		const error = new Error("write failed");
		terminalApi.create = vi.fn().mockResolvedValueOnce({
			status: "ok",
			id: "terminal-1",
		});
		terminalApi.write = vi.fn().mockRejectedValueOnce(error);
		window.flashtypeDesktop = createDesktop(terminalApi);

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
			await screen.findByText("Failed to start terminal"),
		).toBeInTheDocument();
		expect(telemetryMock.captureTelemetry).toHaveBeenCalledWith(
			"agent_start_failed",
			{
				agent: "claude",
				reason: "unexpected",
				surface: "terminal",
				retry_count: 0,
			},
		);
		expect(telemetryMock.captureTelemetryException).toHaveBeenCalledWith(
			error,
			{
				agent: "claude",
				reason: "unexpected",
				surface: "terminal",
				retry_count: 0,
			},
		);
	});
});

function createDesktop(terminalApi: DesktopTerminalApi) {
	return {
		lix: {
			workspaceDir: vi.fn().mockResolvedValue("/workspace"),
		},
		terminal: terminalApi,
	} as unknown as Window["flashtypeDesktop"];
}

function createTerminalApi(): DesktopTerminalApi {
	return {
		create: vi.fn(),
		generateCheckpointName: vi.fn().mockResolvedValue({
			name: "Silly Markdown Pancake",
			source: "codex",
		}),
		getPreferredAgent: vi.fn().mockResolvedValue({
			preferredAgent: "claude",
			autoLaunchAgent: null,
			versionBlockedAutoLaunchAgent: null,
			reason: "fallback",
			agents: {
				claude: {
					authStatus: "unknown",
					installed: false,
					supportedVersion: false,
				},
				codex: {
					authStatus: "unknown",
					installed: false,
					supportedVersion: false,
				},
			},
		}),
		refreshAgentExecutablePaths: vi.fn().mockResolvedValue({
			claude: null,
			codex: null,
		}),
		write: vi.fn().mockResolvedValue(undefined),
		resize: vi.fn().mockResolvedValue(undefined),
		kill: vi.fn().mockResolvedValue(undefined),
		onData: vi.fn(() => vi.fn()),
		onExit: vi.fn(() => vi.fn()),
	};
}
