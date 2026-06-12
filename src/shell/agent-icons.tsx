import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import claudeIcon from "@/assets/claude-icon.png";
import codexIcon from "@/assets/codex-icon.png";

export function ClaudeIcon({ className }: { className?: string }) {
	return (
		<img src={claudeIcon} alt="" className={cn("object-contain", className)} />
	);
}

export function CodexIcon({ className }: { className?: string }) {
	return (
		<img src={codexIcon} alt="" className={cn("object-contain", className)} />
	);
}

/**
 * Per-instance tab icons, keyed by the serializable `state.flashtype.icon`
 * value so a Claude Code terminal can carry the Claude mark instead of the
 * generic terminal icon.
 */
export const TAB_INSTANCE_ICONS: Record<
	string,
	ComponentType<{ className?: string }>
> = {
	claude: ClaudeIcon,
	codex: CodexIcon,
};

/**
 * Agent sessions are terminal instances launched with a command and branded
 * chip metadata. Used by the agent invite and the "+" add-view menu.
 */
export const AGENT_LAUNCH_PRESETS = [
	{
		key: "claude",
		label: "Claude Code",
		icon: ClaudeIcon,
		state: {
			command: "claude --dangerously-skip-permissions",
			flashtype: { label: "Claude Code", icon: "claude" },
		},
	},
	{
		key: "codex",
		label: "Codex",
		icon: CodexIcon,
		state: {
			command: "codex --dangerously-bypass-approvals-and-sandbox",
			flashtype: { label: "Codex", icon: "codex" },
		},
	},
] as const;
