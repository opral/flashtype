import type {
	ExtensionLaunchArgs,
	ExtensionState,
} from "../extension-runtime/types";
import {
	buildAgentTerminalLaunchArgs,
	TERMINAL_INITIAL_COMMAND_LAUNCH_ARG,
} from "@/extension-runtime/agent-terminal-command";

export { TERMINAL_INITIAL_COMMAND_LAUNCH_ARG };

export function buildAgentLaunchArgsWithActiveFile(args: {
	readonly state?: ExtensionState;
	readonly activeFilePath?: string | null;
}): ExtensionLaunchArgs | undefined {
	const prompt = buildFlashtypeActiveFilePrompt(args.activeFilePath);
	return buildAgentTerminalLaunchArgs({ state: args.state, prompt });
}

export function buildFlashtypeActiveFilePrompt(
	filePath: string | null | undefined,
): string | null {
	const promptPath = normalizePromptFilePath(filePath);
	if (!promptPath) {
		return null;
	}
	return `The user is using Flashtype.com. The active file right now, which may change later, is: ${promptPath}`;
}

function normalizePromptFilePath(
	filePath: string | null | undefined,
): string | null {
	const trimmed = filePath?.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith("./")) {
		return trimmed;
	}
	if (trimmed.startsWith("/")) {
		return `.${trimmed}`;
	}
	return `./${trimmed}`;
}
