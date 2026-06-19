import type {
	ExtensionLaunchArgs,
	ExtensionState,
} from "../extension-runtime/types";

export const TERMINAL_INITIAL_COMMAND_LAUNCH_ARG = "initialCommand";

const FLASHTYPE_AGENT_ICONS = new Set(["claude", "codex"]);

export function buildAgentLaunchArgsWithActiveFile(args: {
	readonly state?: ExtensionState;
	readonly activeFilePath?: string | null;
}): ExtensionLaunchArgs | undefined {
	const command =
		typeof args.state?.command === "string" ? args.state.command : null;
	const agentIcon = args.state?.flashtype?.icon;
	if (!command || !agentIcon || !FLASHTYPE_AGENT_ICONS.has(agentIcon)) {
		return undefined;
	}
	const prompt = buildFlashtypeActiveFilePrompt(args.activeFilePath);
	if (!prompt) {
		return undefined;
	}
	return {
		[TERMINAL_INITIAL_COMMAND_LAUNCH_ARG]: buildAgentCommandWithPrompt({
			command,
			agentIcon,
			prompt,
		}),
	};
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

function buildAgentCommandWithPrompt(args: {
	readonly command: string;
	readonly agentIcon: string;
	readonly prompt: string;
}): string {
	if (args.agentIcon === "claude") {
		return `${args.command} --append-system-prompt ${shellQuote(args.prompt)}`;
	}
	if (args.agentIcon === "codex") {
		return `${args.command} -c ${shellQuote(
			`developer_instructions=${JSON.stringify(args.prompt)}`,
		)}`;
	}
	return args.command;
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
	return `./${trimmed.replace(/^\/+/, "")}`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
