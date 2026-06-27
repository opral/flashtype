import { useCallback } from "react";
import { ArrowRight, FilePlus } from "lucide-react";
import type {
	PanelState,
	PanelSide,
	ExtensionContext,
	ExtensionDefinition,
} from "../extension-runtime/types";
import { PanelV2 } from "./panel-v2";

type CentralPanelProps = {
	readonly panel: PanelState;
	readonly onSelectView: (key: string) => void;
	readonly onRemoveView: (key: string) => void;
	readonly viewContext: ExtensionContext;
	readonly onCreateNewFile?: () => void | Promise<void>;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly onFinalizePendingView?: (key: string) => void;
};

/**
 * Central panel - the main content area between left and right panels.
 *
 * @example
 * <CentralPanel
 *   panel={centralPanel}
 *   onSelectView={handleSelect}
 *   onRemoveView={handleRemove}
 *   onCreateNewFile={() => console.log("create")}
 * />
 */
export function CentralPanel({
	panel,
	onSelectView,
	onRemoveView,
	viewContext,
	isFocused,
	onFocusPanel,
	onFinalizePendingView,
	onCreateNewFile,
}: CentralPanelProps) {
	const finalizePendingIfNeeded = useCallback(
		(key: string) => {
			if (!onFinalizePendingView) return;
			const entry = panel.views.find((view) => view.instance === key);
			if (entry?.isPending) {
				onFinalizePendingView(key);
			}
		},
		[onFinalizePendingView, panel.views],
	);

	const emptyState = (
		<EmptyStateContent
			onCreateNewFile={onCreateNewFile}
			onAskAgent={() => viewContext.focusPanel?.("right")}
		/>
	);

	const labelResolver = useCallback(
		(view: ExtensionDefinition, entry: (typeof panel.views)[number]) =>
			(entry.state?.flashtype?.label as string | undefined) ?? view.label,
		[],
	);

	return (
		<PanelV2
			side="central"
			panel={panel}
			isFocused={isFocused}
			onFocusPanel={onFocusPanel}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			viewContext={viewContext}
			tabLabel={labelResolver}
			onActiveViewInteraction={finalizePendingIfNeeded}
			emptyStatePlaceholder={emptyState}
			dropId="central-panel"
			showTabBar={false}
		/>
	);
}

/**
 * Empty editor island in an open workspace: start a document, or hand off to
 * the agent island.
 */
function EmptyStateContent({
	onCreateNewFile,
	onAskAgent,
}: {
	onCreateNewFile?: () => void | Promise<void>;
	onAskAgent?: () => void;
}) {
	return (
		<div
			className="flex h-full flex-col items-center justify-center p-10 text-center"
			data-testid="central-panel-empty-state"
		>
			<FilePlus
				className="size-8 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
				Start writing
			</h1>
			<p className="mt-1.5 max-w-90 text-sm leading-relaxed text-[var(--color-text-secondary)] text-pretty">
				Open a file from the left, or create a new document — saved as plain
				markdown in this folder.
			</p>
			{onCreateNewFile ? (
				<button
					type="button"
					onClick={() => void onCreateNewFile()}
					data-attr="central-empty-new-document"
					className="mt-6 flex items-center gap-2 rounded-[10px] bg-[var(--color-bg-action-primary)] px-6 py-2.75 text-sm font-bold text-[var(--color-text-on-action-primary)] shadow-[0_6px_18px_rgba(154,52,18,0.24),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[var(--color-bg-action-primary-hover)]"
				>
					New document
					<span className="text-[11.5px] font-semibold opacity-75">⌘.</span>
				</button>
			) : null}
			<button
				type="button"
				onClick={onAskAgent}
				data-attr="central-empty-ask-agent"
				className="mt-4.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-[var(--color-icon-tertiary)] hover:text-[var(--color-text-secondary)]"
			>
				or ask your agent to draft one
				<ArrowRight className="size-3" strokeWidth={2} />
			</button>
		</div>
	);
}
