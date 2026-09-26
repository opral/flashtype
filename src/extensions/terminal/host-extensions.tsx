import { useEffect } from "react";
import type {
	AtelierExtensionRegistration,
	AtelierExtensionRuntime,
} from "@opral/atelier";
import {
	ClaudeIcon,
	CodexIcon,
	agentLaunchPresetByKey,
	type AgentKey,
} from "@/shell/agent-icons";
import { buildTerminalLaunchConfig } from "@/extension-runtime/agent-terminal-command";
import { buildAgentLaunchArgsWithActiveFile } from "@/shell/agent-launch";
import { AgentInvite } from "@/shell/agent-invite";
import { TerminalView } from "./index";
import claudeManifestJson from "./claude.manifest.json";
import codexManifestJson from "./codex.manifest.json";

type AtelierDiffApi = NonNullable<AtelierExtensionRuntime["diff"]>;
type ExtensionManifest = Omit<AtelierExtensionRegistration, "Component">;

const activeDiffs = new Map<AtelierDiffApi, number>();
export const agentDiffBridge = {
	async open(options: {
		beforeCommitId: string;
		afterCommitId: string;
	}) {
		const diff = [...activeDiffs.keys()].at(-1);
		if (!diff) throw new Error("Agent review runtime is unavailable");
		await diff.open({
			base: { commitId: options.beforeCommitId },
			target: { commitId: options.afterCommitId },
			intent: "review-applied",
			reveal: true,
		});
	},
};

const claudeManifest = claudeManifestJson as ExtensionManifest;
const codexManifest = codexManifestJson as ExtensionManifest;

export const AGENT_WELCOME_EXTENSION: AtelierExtensionRegistration = {
	id: "flashtype_agents",
	name: "Agents",
	placement: ["right"],
	Component: ({ atelier }) => (
		<AgentInvite
			onStartClaude={() => void atelier.views.open("flashtype_claude", { area: "right" })}
			onStartCodex={() => void atelier.views.open("flashtype_codex", { area: "right" })}
		/>
	),
};

export const FLASHTYPE_ATELIER_EXTENSIONS = [
	createAgentExtension({
		manifest: claudeManifest,
		agent: "claude",
		icon: ClaudeIcon,
	}),
	createAgentExtension({
		manifest: codexManifest,
		agent: "codex",
		icon: CodexIcon,
	}),
] as const satisfies readonly AtelierExtensionRegistration[];

function createAgentExtension(args: {
	readonly manifest: ExtensionManifest;
	readonly agent: "claude" | "codex";
	readonly icon: typeof ClaudeIcon;
}): AtelierExtensionRegistration {
	return {
		...args.manifest,
		placement: ["left", "main", "right"],
		icon: args.icon,
		Component: ({ atelier }) => {
			useEffect(() => {
				if (!atelier.diff) return;
				const diff = atelier.diff;
				activeDiffs.set(diff, (activeDiffs.get(diff) ?? 0) + 1);
				return () => {
					const count = activeDiffs.get(diff);
					if (count === undefined || count <= 1) {
						activeDiffs.delete(diff);
					} else {
						activeDiffs.set(diff, count - 1);
					}
				};
			}, [atelier.diff]);
			return (
				<TerminalView launchConfig={createAgentHostLaunchConfig(args.agent)} />
			);
		},
	};
}

/** Builds the host launch with FlashType's prompt and Electron hook wrapper. */
export function createAgentHostLaunchConfig(agent: AgentKey) {
	const preset = agentLaunchPresetByKey(agent);
	if (!preset) {
		throw new Error(`Missing ${agent} terminal launch preset.`);
	}
	return buildTerminalLaunchConfig({
		state: preset.state,
		launchArgs: buildAgentLaunchArgsWithActiveFile({
			state: preset.state,
		}),
	});
}
