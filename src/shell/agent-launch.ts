import type {
	ExtensionLaunchArgs,
	ExtensionState,
} from "../extension-runtime/types";
import {
	buildAgentTerminalLaunchArgs,
	TERMINAL_INITIAL_COMMAND_LAUNCH_ARG,
} from "@/extension-runtime/agent-terminal-command";

export { TERMINAL_INITIAL_COMMAND_LAUNCH_ARG };

export const FLASHTYPE_INITIAL_PROMPT =
	"You are running inside Flashtype, a local Markdown editor with inline diff review.\n\nUse the workspace files as the source of truth. When the user requests changes, edit the relevant files in place so the user can review clear, focused diffs before applying them. Preserve file identity, structure, metadata, formatting style, and revision lineage; do not delete and recreate files unless explicitly instructed.\n\nKeep edits minimal and targeted to the request. If the requested change is ambiguous or could affect unrelated content, ask for clarification before editing.";

export function buildAgentLaunchArgsWithActiveFile(args: {
	readonly state?: ExtensionState;
	readonly activeFilePath?: string | null;
}): ExtensionLaunchArgs | undefined {
	return buildAgentTerminalLaunchArgs({
		state: args.state,
		prompt: FLASHTYPE_INITIAL_PROMPT,
	});
}

export function buildFlashtypeActiveFilePrompt(
	filePath: string | null | undefined,
): string | null {
	const promptPath = normalizePromptFilePath(filePath);
	if (!promptPath) {
		return null;
	}
	return `The current document is: ${promptPath}`;
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
