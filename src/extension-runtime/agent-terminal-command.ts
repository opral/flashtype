import type { ExtensionLaunchArgs, ExtensionState } from "./types";

export const TERMINAL_INITIAL_COMMAND_LAUNCH_ARG = "initialCommand";

const FLASHTYPE_AGENT_ICONS = new Set(["claude", "codex"]);
const AGENT_HOOK_TIMEOUT_SECONDS = 10;

export type FlashtypeAgentIcon = "claude" | "codex";

export function buildTerminalInitialCommand(args: {
	readonly state?: ExtensionState;
	readonly launchArgs?: ExtensionLaunchArgs;
}): string | undefined {
	const launchCommand =
		typeof args.launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG] === "string"
			? args.launchArgs[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]
			: undefined;
	if (launchCommand) {
		return launchCommand;
	}
	const command =
		typeof args.state?.command === "string" ? args.state.command : null;
	if (!command) {
		return undefined;
	}
	const agentIcon = readFlashtypeAgentIcon(args.state?.flashtype?.icon);
	if (!agentIcon) {
		return command;
	}
	return buildAgentTerminalInitialCommand({
		command,
		agentIcon,
		prompt: null,
	});
}

export function buildAgentTerminalLaunchArgs(args: {
	readonly state?: ExtensionState;
	readonly prompt?: string | null;
}): ExtensionLaunchArgs | undefined {
	const command =
		typeof args.state?.command === "string" ? args.state.command : null;
	const agentIcon = readFlashtypeAgentIcon(args.state?.flashtype?.icon);
	if (!command || !agentIcon) {
		return undefined;
	}
	return {
		[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]: buildAgentTerminalInitialCommand({
			command,
			agentIcon,
			prompt: args.prompt ?? null,
		}),
	};
}

export function buildAgentTerminalInitialCommand(args: {
	readonly command: string;
	readonly agentIcon: FlashtypeAgentIcon;
	readonly prompt?: string | null;
}): string {
	if (args.agentIcon === "claude") {
		return [
			args.command,
			"--settings",
			shellQuote(JSON.stringify(buildClaudeHookSettings())),
			args.prompt ? `--append-system-prompt ${shellQuote(args.prompt)}` : null,
		]
			.filter(Boolean)
			.join(" ");
	}
	return [
		args.command,
		"--dangerously-bypass-hook-trust",
		"-c",
		shellQuote(
			buildCodexHookConfig(
				"UserPromptSubmit",
				buildAgentHookCommand("codex", "turn-start"),
				"Tracking Flashtype turn start",
			),
		),
		"-c",
		shellQuote(
			buildCodexHookConfig(
				"Stop",
				buildAgentHookCommand("codex", "turn-stop"),
				"Tracking Flashtype turn stop",
			),
		),
		args.prompt
			? `-c ${shellQuote(
					`developer_instructions=${JSON.stringify(args.prompt)}`,
				)}`
			: null,
	]
		.filter(Boolean)
		.join(" ");
}

export function readFlashtypeAgentIcon(
	value: unknown,
): FlashtypeAgentIcon | null {
	return typeof value === "string" && FLASHTYPE_AGENT_ICONS.has(value)
		? (value as FlashtypeAgentIcon)
		: null;
}

function buildClaudeHookSettings() {
	return {
		hooks: {
			UserPromptSubmit: [
				{
					hooks: [
						{
							type: "command",
							command: buildAgentHookCommand("claude", "turn-start"),
							timeout: AGENT_HOOK_TIMEOUT_SECONDS,
							statusMessage: "Tracking Flashtype turn start",
						},
					],
				},
			],
			Stop: [
				{
					hooks: [
						{
							type: "command",
							command: buildAgentHookCommand("claude", "turn-stop"),
							timeout: AGENT_HOOK_TIMEOUT_SECONDS,
							statusMessage: "Tracking Flashtype turn stop",
						},
					],
				},
			],
			StopFailure: [
				{
					hooks: [
						{
							type: "command",
							command: buildAgentHookCommand("claude", "turn-stop"),
							timeout: AGENT_HOOK_TIMEOUT_SECONDS,
							statusMessage: "Tracking Flashtype turn stop",
						},
					],
				},
			],
		},
	};
}

function buildCodexHookConfig(
	eventName: "UserPromptSubmit" | "Stop",
	command: string,
	statusMessage: string,
): string {
	return `hooks.${eventName}=[{hooks=[{type="command",command=${tomlString(
		command,
	)},timeout=${AGENT_HOOK_TIMEOUT_SECONDS},statusMessage=${tomlString(
		statusMessage,
	)}}]}]`;
}

function buildAgentHookCommand(
	agent: "claude" | "codex",
	phase: "turn-start" | "turn-stop",
): string {
	return `node "$FLASHTYPE_AGENT_HOOK_SCRIPT" ${agent} ${phase}`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
