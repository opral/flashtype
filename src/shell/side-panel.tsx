import type {
	PanelSide,
	PanelState,
	ExtensionKind,
	ExtensionContext,
	ExtensionState,
} from "../extension-runtime/types";
import { TERMINAL_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import { PanelV2 } from "./panel-v2";
import { AgentInvite } from "./agent-invite";
import { agentLaunchPresetByKey, type AgentKey } from "./agent-icons";

interface SidePanelProps {
	readonly side: PanelSide;
	readonly title: string;
	readonly panel: PanelState;
	readonly onSelectView: (key: string) => void;
	readonly onAddView: (toolId: ExtensionKind, state?: ExtensionState) => void;
	readonly onRemoveView: (key: string) => void;
	readonly viewContext: ExtensionContext;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly preferredAgent?: AgentKey | null;
}

/**
 * Renders a side panel with its nav and active content.
 *
 * @example
 * <SidePanel side="left" title="Left" panel={panelState} ... />
 */
export function SidePanel({
	side,
	title: _unusedTitle,
	panel,
	onSelectView,
	onAddView,
	onRemoveView,
	viewContext,
	isFocused,
	onFocusPanel,
	preferredAgent,
}: SidePanelProps) {
	// The right island is the agent's home: empty means inviting the agent in.
	// The command lives in persisted state, so restoring the workspace
	// relaunches the agent instead of showing a bare shell labeled after it.
	const emptyState =
		side === "right" ? (
			<AgentInvite
				onStartClaude={() =>
					onAddView(
						TERMINAL_EXTENSION_KIND,
						agentLaunchPresetByKey("claude")?.state,
					)
				}
				onStartCodex={() =>
					onAddView(
						TERMINAL_EXTENSION_KIND,
						agentLaunchPresetByKey("codex")?.state,
					)
				}
				preferredAgent={preferredAgent}
			/>
		) : (
			<div className="flex flex-1 items-center justify-center">
				<span className="text-[12.5px] text-[var(--color-icon-tertiary)]">
					No view open
				</span>
			</div>
		);

	return (
		<PanelV2
			side={side}
			panel={panel}
			isFocused={isFocused}
			onFocusPanel={onFocusPanel}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			onAddView={onAddView}
			viewContext={viewContext}
			emptyStatePlaceholder={emptyState}
		/>
	);
}
