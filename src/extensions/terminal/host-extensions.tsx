import { useEffect } from "react";
import type {
	AtelierExtensionRegistration,
	AtelierDiffApi,
	ExtensionManifest,
} from "@opral/atelier";
import {
	ClaudeIcon,
	CodexIcon,
	agentLaunchPresetByKey,
	type AgentKey,
} from "@/shell/agent-icons";
import { buildTerminalLaunchConfig } from "@/extension-runtime/agent-terminal-command";
import { buildAgentLaunchArgsWithActiveFile } from "@/shell/agent-launch";
import { TerminalView } from "./index";
import claudeManifestJson from "./claude.manifest.json";
import codexManifestJson from "./codex.manifest.json";

const activeDiffs = new Set<AtelierDiffApi>();
export const agentDiffBridge = {
	async open(options: { beforeCommitId: string; afterCommitId: string }) {
		const diff = [...activeDiffs].at(-1);
		if (!diff) throw new Error("Agent review runtime is unavailable");
		await diff.open({
			base: { commitId: options.beforeCommitId },
			target: { commitId: options.afterCommitId },
			reveal: true,
			intent: "review-applied",
		});
	},
};

const claudeManifest = claudeManifestJson as ExtensionManifest;
const codexManifest = codexManifestJson as ExtensionManifest;

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
		icon: args.icon,
		Component: ({ atelier }) => {
			useEffect(() => {
				if (!atelier.diff) return;
				activeDiffs.add(atelier.diff);
				return () => {
					activeDiffs.delete(atelier.diff!);
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
