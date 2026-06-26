import { describe, expect, test } from "vitest";
import {
	TERMINAL_INITIAL_COMMAND_LAUNCH_ARG,
	buildAgentLaunchArgsWithActiveFile,
	buildFlashtypeActiveFilePrompt,
} from "./agent-launch";
import { buildTerminalInitialCommand } from "@/extension-runtime/agent-terminal-command";

describe("buildFlashtypeActiveFilePrompt", () => {
	test("uses the Flashtype.com launch-context sentence", () => {
		expect(buildFlashtypeActiveFilePrompt("/docs/intro.md")).toBe(
			"The user is using Flashtype.com. The active file right now, which may change later, is: ./docs/intro.md",
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
	test("adds a Claude append-system-prompt launch command", () => {
		const launchArgs = buildAgentLaunchArgsWithActiveFile({
			state: {
				command: "claude --dangerously-skip-permissions",
				flashtype: { icon: "claude" },
			},
			activeFilePath: "/docs/intro.md",
		});

		const command = String(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]);
		expect(command).toContain("claude --dangerously-skip-permissions");
		expect(command).not.toContain("--setting-sources");
		expect(command).toContain("--settings");
		expect(command).toContain("UserPromptSubmit");
		expect(command).toContain("StopFailure");
		expect(command).toContain(
			'node \\"$FLASHTYPE_AGENT_HOOK_SCRIPT\\" claude turn-start',
		);
		expect(command).toContain(
			"--append-system-prompt 'The user is using Flashtype.com. The active file right now, which may change later, is: ./docs/intro.md'",
		);
	});

	test("adds a Codex developer-instructions launch command", () => {
		const launchArgs = buildAgentLaunchArgsWithActiveFile({
			state: {
				command: "codex --dangerously-bypass-approvals-and-sandbox",
				flashtype: { icon: "codex" },
			},
			activeFilePath: "/docs/intro.md",
		});

		const command = String(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]);
		expect(command).toContain(
			"codex --dangerously-bypass-approvals-and-sandbox",
		);
		expect(command).toContain("--dangerously-bypass-hook-trust");
		expect(command).toContain("hooks.UserPromptSubmit=");
		expect(command).toContain("hooks.Stop=");
		expect(command).toContain(
			'node \\"$FLASHTYPE_AGENT_HOOK_SCRIPT\\" codex turn-start',
		);
		expect(command).toContain(
			"-c 'developer_instructions=\"The user is using Flashtype.com. The active file right now, which may change later, is: ./docs/intro.md\"'",
		);
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
		expect(command).toContain("hooks.UserPromptSubmit=");
		expect(command).not.toContain("developer_instructions=");
	});

	test("injects hooks into restored agent terminal commands", () => {
		const command = buildTerminalInitialCommand({
			state: {
				command: "claude --dangerously-skip-permissions",
				flashtype: { icon: "claude" },
			},
		});

		expect(command).toContain("claude --dangerously-skip-permissions");
		expect(command).not.toContain("--setting-sources");
		expect(command).toContain("--settings");
		expect(command).toContain("UserPromptSubmit");
		expect(command).toContain("StopFailure");
		expect(command).not.toContain("--append-system-prompt");
	});

	test("keeps Claude setting sources from the configured command", () => {
		const command = buildTerminalInitialCommand({
			state: {
				command:
					"claude --setting-sources user,project --dangerously-skip-permissions",
				flashtype: { icon: "claude" },
			},
		});

		expect(command).toContain("--setting-sources user,project");
		expect(command).not.toContain("--setting-sources ''");
		expect(command).toContain("--settings");
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
