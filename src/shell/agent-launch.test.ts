import { describe, expect, test } from "vitest";
import {
	TERMINAL_INITIAL_COMMAND_LAUNCH_ARG,
	buildAgentLaunchArgsWithActiveFile,
	buildFlashtypeActiveFilePrompt,
} from "./agent-launch";

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

		expect(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]).toBe(
			"claude --dangerously-skip-permissions --append-system-prompt 'The user is using Flashtype.com. The active file right now, which may change later, is: ./docs/intro.md'",
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

		expect(launchArgs?.[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]).toBe(
			"codex --dangerously-bypass-approvals-and-sandbox -c 'developer_instructions=\"The user is using Flashtype.com. The active file right now, which may change later, is: ./docs/intro.md\"'",
		);
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
