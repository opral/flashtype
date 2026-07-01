import { describe, expect, test } from "vitest";
import {
	FLASHTYPE_INITIAL_PROMPT,
	TERMINAL_INITIAL_COMMAND_LAUNCH_ARG,
	buildAgentLaunchArgsWithActiveFile,
	buildFlashtypeActiveFilePrompt,
} from "./agent-launch";
import {
	TERMINAL_PATH_WRAPPER_LAUNCH_ARG,
	buildTerminalInitialCommand,
	buildTerminalLaunchConfig,
} from "@/extension-runtime/agent-terminal-command";

describe("buildFlashtypeActiveFilePrompt", () => {
	test("uses the active-file context sentence", () => {
		expect(buildFlashtypeActiveFilePrompt("/docs/intro.md")).toBe(
			"The current document is: ./docs/intro.md",
		);
	});

	test("preserves already-relative dot paths", () => {
		expect(buildFlashtypeActiveFilePrompt("./docs/intro.md")).toContain(
			"./docs/intro.md",
		);
	});

	test("returns null without a file path", () => {
		expect(buildFlashtypeActiveFilePrompt("")).toBeNull();
	});
});

describe("buildAgentLaunchArgsWithActiveFile", () => {
	test("adds Claude hook launch args with Flashtype system prompt only", () => {
		const launchArgs = buildAgentLaunchArgsWithActiveFile({
			state: {
				command: "claude --dangerously-skip-permissions",
				flashtype: { icon: "claude" },
			},
			activeFilePath: "/docs/intro.md",
		});

		const command = String(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]);
		const pathWrapper = launchArgs?.[TERMINAL_PATH_WRAPPER_LAUNCH_ARG] as {
			command: string;
			executableName: string;
		};
		expect(command).toBe("claude-flashtype");
		expect(pathWrapper.executableName).toBe("claude-flashtype");
		expect(pathWrapper.command).toContain(
			"claude --dangerously-skip-permissions",
		);
		expect(pathWrapper.command).not.toContain("--setting-sources");
		expect(pathWrapper.command).toContain("--settings");
		expect(pathWrapper.command).toContain("UserPromptSubmit");
		expect(pathWrapper.command).toContain("StopFailure");
		expect(pathWrapper.command).toContain(
			'ELECTRON_RUN_AS_NODE=1 \\"$FLASHTYPE_AGENT_HOOK_NODE\\" \\"$FLASHTYPE_AGENT_HOOK_SCRIPT\\" claude turn-start',
		);
		expect(pathWrapper.command).toContain(
			`--append-system-prompt '${FLASHTYPE_INITIAL_PROMPT}'`,
		);
		expect(pathWrapper.command).not.toContain("./docs/intro.md");
	});

	test("adds Codex hook launch args with Flashtype developer instructions only", () => {
		const launchArgs = buildAgentLaunchArgsWithActiveFile({
			state: {
				command: "codex --dangerously-bypass-approvals-and-sandbox",
				flashtype: { icon: "codex" },
			},
			activeFilePath: "/docs/intro.md",
		});

		const command = String(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]);
		const pathWrapper = launchArgs?.[TERMINAL_PATH_WRAPPER_LAUNCH_ARG] as {
			command: string;
			executableName: string;
		};
		expect(command).toBe("codex-flashtype");
		expect(pathWrapper.executableName).toBe("codex-flashtype");
		expect(pathWrapper.command).toContain(
			"codex --dangerously-bypass-approvals-and-sandbox",
		);
		expect(pathWrapper.command).toContain("--dangerously-bypass-hook-trust");
		expect(pathWrapper.command).toContain("hooks.UserPromptSubmit=");
		expect(pathWrapper.command).toContain("hooks.Stop=");
		expect(pathWrapper.command).toContain(
			'ELECTRON_RUN_AS_NODE=1 \\"$FLASHTYPE_AGENT_HOOK_NODE\\" \\"$FLASHTYPE_AGENT_HOOK_SCRIPT\\" codex turn-start',
		);
		expect(pathWrapper.command).toContain(
			`-c 'developer_instructions=${JSON.stringify(FLASHTYPE_INITIAL_PROMPT)}'`,
		);
		expect(pathWrapper.command).not.toContain("./docs/intro.md");
	});

	test("injects hooks for agent launches without an active file", () => {
		const launchArgs = buildAgentLaunchArgsWithActiveFile({
			state: {
				command: "codex --dangerously-bypass-approvals-and-sandbox",
				flashtype: { icon: "codex" },
			},
			activeFilePath: null,
		});

		const command = String(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]);
		const pathWrapper = launchArgs?.[TERMINAL_PATH_WRAPPER_LAUNCH_ARG] as {
			command: string;
		};
		expect(command).toBe("codex-flashtype");
		expect(pathWrapper.command).toContain("hooks.UserPromptSubmit=");
		expect(pathWrapper.command).toContain(
			`developer_instructions=${JSON.stringify(FLASHTYPE_INITIAL_PROMPT)}`,
		);
	});

	test("injects hooks into restored agent terminal commands", () => {
		const launchConfig = buildTerminalLaunchConfig({
			state: {
				command: "claude --dangerously-skip-permissions",
				flashtype: { icon: "claude" },
			},
		});

		expect(launchConfig.initialCommand).toBe("claude-flashtype");
		expect(
			buildTerminalInitialCommand({
				launchArgs: {
					[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]: launchConfig.initialCommand,
					[TERMINAL_PATH_WRAPPER_LAUNCH_ARG]: launchConfig.pathWrapper,
				},
			}),
		).toBe("claude-flashtype");
		expect(launchConfig.pathWrapper?.command).toContain(
			"claude --dangerously-skip-permissions",
		);
		expect(launchConfig.pathWrapper?.command).not.toContain(
			"--setting-sources",
		);
		expect(launchConfig.pathWrapper?.command).toContain("--settings");
		expect(launchConfig.pathWrapper?.command).toContain("UserPromptSubmit");
		expect(launchConfig.pathWrapper?.command).toContain("StopFailure");
		expect(launchConfig.pathWrapper?.command).not.toContain(
			"--append-system-prompt",
		);
	});

	test("keeps Claude setting sources from the configured command", () => {
		const launchConfig = buildTerminalLaunchConfig({
			state: {
				command:
					"claude --setting-sources user,project --dangerously-skip-permissions",
				flashtype: { icon: "claude" },
			},
		});

		expect(launchConfig.initialCommand).toBe("claude-flashtype");
		expect(launchConfig.pathWrapper?.command).toContain(
			"--setting-sources user,project",
		);
		expect(launchConfig.pathWrapper?.command).not.toContain(
			"--setting-sources ''",
		);
		expect(launchConfig.pathWrapper?.command).toContain("--settings");
	});

	test("does not alter non-agent terminal launches", () => {
		expect(
			buildAgentLaunchArgsWithActiveFile({
				state: { command: "zsh" },
				activeFilePath: "/docs/intro.md",
			}),
		).toBeUndefined();
	});
});
