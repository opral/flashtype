import { createRoot } from "react-dom/client";
import type {
	AtelierExtensionRegistration,
	ExtensionManifest,
	ExtensionRuntimeEntry,
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
	const mount: ExtensionRuntimeEntry["mount"] = ({ element }) => {
		const root = createRoot(element);
		root.render(
			<TerminalView launchConfig={createAgentHostLaunchConfig(args.agent)} />,
		);
		return {
			dispose: () => root.unmount(),
		};
	};
	return {
		manifest: args.manifest,
		entry: {
			icon: args.icon,
			mount,
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
