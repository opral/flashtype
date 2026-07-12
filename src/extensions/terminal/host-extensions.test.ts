import { describe, expect, test } from "vitest";
import { FLASHTYPE_INITIAL_PROMPT } from "@/shell/agent-launch";
import { createAgentHostLaunchConfig } from "./host-extensions";

describe("createAgentHostLaunchConfig", () => {
	test("launches Claude with FlashType's system prompt and hooks", () => {
		const config = createAgentHostLaunchConfig("claude");

		expect(config.initialCommand).toBe("claude-flashtype");
		expect(config.pathWrapper?.command).toContain("--append-system-prompt");
		expect(config.pathWrapper?.command).toContain(FLASHTYPE_INITIAL_PROMPT);
		expect(config.pathWrapper?.command).toContain("UserPromptSubmit");
		expect(config.pathWrapper?.command).toContain("StopFailure");
	});

	test("launches Codex with FlashType's developer prompt and hooks", () => {
		const config = createAgentHostLaunchConfig("codex");

		expect(config.initialCommand).toBe("codex-flashtype");
		expect(config.pathWrapper?.command).toContain("developer_instructions=");
		expect(config.pathWrapper?.command).toContain(
			JSON.stringify(FLASHTYPE_INITIAL_PROMPT),
		);
		expect(config.pathWrapper?.command).toContain("hooks.UserPromptSubmit=");
		expect(config.pathWrapper?.command).toContain("hooks.Stop=");
	});
});
