import { useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { captureTelemetry, captureTelemetryException } from "@/lib/telemetry";
import type { TerminalLaunchConfig } from "../../extension-runtime/agent-terminal-command";
import { createTerminalOutputNormalizer } from "./ansi-style-normalizer";

function cssColor(name: string, fallback: string): string {
	if (typeof window === "undefined") return fallback;
	const value = window
		.getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
}

function buildTerminalTheme() {
	return {
		background: cssColor("--color-bg-panel", "#ffffff"),
		foreground: cssColor("--color-text-primary", "#1c1917"),
		cursor: cssColor("--color-text-primary", "#1c1917"),
		selectionBackground: cssColor("--color-bg-selection-current", "#fbefe4"),
		selectionInactiveBackground: cssColor("--color-bg-hover", "#f5f2ed"),
		black: cssColor("--color-bg-hover", "#f5f2ed"),
		red: cssColor("--color-error-700", "#b91c1c"),
		green: cssColor("--color-success-700", "#15803d"),
		yellow: cssColor("--color-warning-800", "#854d0e"),
		blue: cssColor("--color-text-secondary", "#44403c"),
		magenta: cssColor("--color-text-secondary", "#44403c"),
		cyan: "#0e7490",
		white: cssColor("--color-neutral-800", "#292524"),
		brightBlack: cssColor("--color-icon-tertiary", "#78716c"),
		brightRed: cssColor("--color-error-600", "#dc2626"),
		brightGreen: cssColor("--color-success-600", "#16a34a"),
		brightYellow: cssColor("--color-warning-700", "#a16207"),
		brightBlue: cssColor("--color-icon-secondary", "#57534e"),
		brightMagenta: cssColor("--color-icon-secondary", "#57534e"),
		brightCyan: "#0891b2",
		brightWhite: cssColor("--color-text-primary", "#1c1917"),
	};
}

type TerminalCreateResult = Awaited<
	ReturnType<NonNullable<Window["flashtypeDesktop"]>["terminal"]["create"]>
>;
type AgentVersionErrorResult = Extract<
	TerminalCreateResult,
	{ status: "agentVersionError" }
>;
type TerminalStartupError =
	| { kind: "agentVersion"; error: AgentVersionErrorResult }
	| { kind: "unexpected"; error: unknown };
type AgentTelemetryName = AgentVersionErrorResult["agent"];

export function TerminalView({
	launchConfig,
}: {
	/** One-shot terminal startup command and private PATH wrapper, if needed. */
	readonly launchConfig: TerminalLaunchConfig;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const launchConfigRef = useRef(launchConfig);
	const [startupError, setStartupError] = useState<TerminalStartupError | null>(
		null,
	);
	const [retryKey, setRetryKey] = useState(0);

	useEffect(() => {
		const desktop = window.flashtypeDesktop;
		const terminalApi = desktop?.terminal;
		const container = containerRef.current;

		if (!desktop?.lix || !terminalApi || !container) {
			return;
		}

		let disposed = false;
		let cleanedUp = false;
		let terminalId: string | null = null;
		const attemptLaunchConfig = launchConfigRef.current;

		setStartupError(null);
		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			lineHeight: 1.2,
			scrollback: 3000,
			minimumContrastRatio: 4.5,
			allowTransparency: false,
			theme: buildTerminalTheme(),
		});
		terminalRef.current = terminal;
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		fitAddon.fit();

		const handleResize = () => {
			if (disposed) return;
			fitAddon.fit();
			if (!terminalId) return;
			void terminalApi.resize({
				id: terminalId,
				cols: terminal.cols,
				rows: terminal.rows,
			});
		};

		const resizeObserver = new ResizeObserver(() => {
			handleResize();
		});
		resizeObserver.observe(container);
		const outputNormalizer = createTerminalOutputNormalizer();

		const stopData = terminalApi.onData((event) => {
			if (event.id !== terminalId) return;
			terminal.write(outputNormalizer.write(event.data));
		});
		const stopExit = terminalApi.onExit((event) => {
			if (event.id !== terminalId) return;
			const pendingOutput = outputNormalizer.flush();
			if (pendingOutput) {
				terminal.write(pendingOutput);
			}
			terminal.writeln("");
			terminal.writeln(
				`[process exited${event.exitCode !== null ? ` (${event.exitCode})` : ""}]`,
			);
		});

		const inputDisposable = terminal.onData((data) => {
			if (!terminalId) return;
			void terminalApi.write({ id: terminalId, data });
		});

		const cleanupLocalTerminal = (options: { kill?: boolean } = {}) => {
			if (cleanedUp) return;
			cleanedUp = true;
			disposed = true;
			resizeObserver.disconnect();
			stopData();
			stopExit();
			inputDisposable.dispose();
			if (terminalId && options.kill !== false) {
				void terminalApi.kill({ id: terminalId });
			}
			terminalRef.current = null;
			terminal.dispose();
		};

		const showStartupError = (error: TerminalStartupError) => {
			if (disposed) return;
			captureAgentStartFailure(error, {
				launchConfig: attemptLaunchConfig,
				retryCount: retryKey,
			});
			setStartupError(error);
			cleanupLocalTerminal();
		};

		void (async () => {
			try {
				const cwd = await desktop.lix.workspaceDir();
				if (disposed) {
					return;
				}
				const created = await terminalApi.create({
					cwd,
					cols: terminal.cols,
					rows: terminal.rows,
					pathWrapper: attemptLaunchConfig.pathWrapper,
				});
				if (created.status === "agentVersionError") {
					showStartupError({ kind: "agentVersion", error: created });
					return;
				}
				if (disposed) {
					await terminalApi.kill({ id: created.id });
					return;
				}
				terminalId = created.id;
				handleResize();
				const command = attemptLaunchConfig.initialCommand;
				if (command) {
					await terminalApi.write({ id: created.id, data: `${command}\r` });
				}
				launchConfigRef.current = {};
			} catch (error) {
				showStartupError({ kind: "unexpected", error });
			}
		})();

		return () => {
			cleanupLocalTerminal();
		};
	}, [retryKey]);

	if (!window.flashtypeDesktop?.terminal) {
		return (
			<div className="flex h-full min-h-0 items-center justify-center px-4 text-sm text-[var(--color-text-secondary)]">
				Terminal is only available in the desktop app.
			</div>
		);
	}

	if (startupError) {
		return (
			<TerminalStartupErrorView
				error={startupError}
				onRetry={() => {
					setStartupError(null);
					setRetryKey((value) => value + 1);
				}}
			/>
		);
	}

	return (
		<div
			className="ph-mask h-full min-h-0"
			style={{ backgroundColor: cssColor("--color-bg-panel", "#ffffff") }}
		>
			<div ref={containerRef} className="h-full w-full p-2" />
		</div>
	);
}

function captureAgentStartFailure(
	error: TerminalStartupError,
	options: {
		readonly launchConfig: TerminalLaunchConfig;
		readonly retryCount: number;
	},
) {
	const properties = agentStartFailureTelemetryProperties(error, options);
	if (!properties) return;
	captureTelemetry("agent_start_failed", properties);
	if (error.kind === "unexpected") {
		captureTelemetryException(error.error, properties);
	}
}

function agentStartFailureTelemetryProperties(
	error: TerminalStartupError,
	options: {
		readonly launchConfig: TerminalLaunchConfig;
		readonly retryCount: number;
	},
) {
	const common = {
		surface: "terminal",
		retry_count: options.retryCount,
	} as const;
	if (error.kind === "agentVersion") {
		return {
			...common,
			agent: error.error.agent,
			reason: error.error.reason,
			required_version: error.error.requiredVersion,
			detected_version: error.error.detectedVersion,
		};
	}
	const agent = readAgentTelemetryName(options.launchConfig);
	if (!agent) return null;
	return {
		...common,
		agent,
		reason: "unexpected",
	};
}

function readAgentTelemetryName(
	launchConfig: TerminalLaunchConfig,
): AgentTelemetryName | null {
	const executableName = launchConfig.pathWrapper?.executableName;
	if (executableName === "claude-flashtype") return "claude";
	if (executableName === "codex-flashtype") return "codex";
	return null;
}

function TerminalStartupErrorView({
	error,
	onRetry,
}: {
	readonly error: TerminalStartupError;
	readonly onRetry: () => void;
}) {
	const formatted = formatTerminalStartupError(error);
	return (
		<div
			className="flex h-full min-h-0 items-center justify-center bg-[var(--color-bg-panel)] px-6 py-8"
			role="alert"
			aria-live="assertive"
		>
			<div className="max-w-md rounded-md border border-[var(--color-border)] bg-[var(--color-bg-app)] p-4 text-sm shadow-sm">
				<div className="flex items-start gap-3">
					<AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-error-600)]" />
					<div className="min-w-0">
						<h2 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
							{formatted.title}
						</h2>
						<p className="mt-1 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
							{formatted.message}
						</p>
						<Button type="button" size="sm" className="mt-4" onClick={onRetry}>
							<RotateCcw className="size-3.5" />
							Retry
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

function formatTerminalStartupError(error: TerminalStartupError): {
	title: string;
	message: string;
} {
	if (error.kind !== "agentVersion") {
		return {
			title: "Failed to start terminal",
			message:
				error.error instanceof Error
					? error.error.message
					: String(error.error),
		};
	}

	const agent = error.error.agent === "claude" ? "Claude Code" : "Codex";
	const command = error.error.agent;
	const required = error.error.requiredVersion;
	switch (error.error.reason) {
		case "missing":
			return {
				title: `${agent} not found`,
				message: `Flashtype could not find ${command} in this terminal environment. Install ${agent} ${required} or newer, then try again.`,
			};
		case "unsupported":
			return {
				title: `${agent} update required`,
				message: `Flashtype needs ${agent} ${required} or newer for hooks. Detected ${error.error.detectedVersion ?? "an older version"}.`,
			};
		case "unparseable":
			return {
				title: `Could not read ${agent} version`,
				message: `Flashtype ran ${command} --version but could not find a semantic version in the output. Update ${agent} to ${required} or newer, then try again.`,
			};
		case "timeout":
			return {
				title: `${agent} version check timed out`,
				message: `Flashtype ran ${command} --version, but it did not finish. Check your ${agent} installation and try again.`,
			};
		case "failed":
			return {
				title: `${agent} version check failed`,
				message: `Flashtype ran ${command} --version, but the command failed. Install ${agent} ${required} or newer, then try again.`,
			};
	}
}
