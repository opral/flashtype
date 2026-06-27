import type { JSX } from "react";
import claudeIcon from "@/assets/claude-icon.png";
import codexIcon from "@/assets/codex-icon.png";

/**
 * The agent island's invite: explains that agents write here. On first run it
 * is copy only; once a workspace is open, the start CTAs appear.
 *
 * @example
 * <AgentInvite onStartClaude={() => openTerminal("claude")} />
 */
export function AgentInvite({
	onStartClaude,
	onStartCodex,
}: {
	readonly onStartClaude?: () => void;
	readonly onStartCodex?: () => void;
}): JSX.Element {
	return (
		<div
			className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 py-7 text-center"
			data-attr="agent-panel"
		>
			<div className="flex items-center gap-2.75">
				<img
					src={claudeIcon}
					alt="Claude"
					className="size-7.5 object-contain"
				/>
				<img src={codexIcon} alt="Codex" className="size-8 object-contain" />
			</div>
			<div className="text-[14.5px] font-bold text-[var(--color-text-primary)]">
				Your agent writes here
			</div>
			<p className="max-w-55 text-[12.5px] leading-relaxed text-[var(--color-text-secondary)] text-pretty">
				Claude Code or Codex edits your files directly — every change is a diff
				you approve.
			</p>
			{onStartClaude ? (
				<div className="mt-0.5 flex flex-col items-center gap-2.25">
					<button
						type="button"
						onClick={onStartClaude}
						data-attr="agent-start-claude"
						className="flex items-center gap-1.75 rounded-lg bg-[var(--color-bg-action-secondary)] px-4.5 py-2.25 text-[12.5px] font-bold text-[var(--color-text-on-action-secondary)] hover:bg-[var(--color-bg-action-secondary-hover)]"
					>
						<img src={claudeIcon} alt="" className="size-3.25 object-contain" />
						Start Claude Code
					</button>
					{onStartCodex ? (
						<button
							type="button"
							onClick={onStartCodex}
							data-attr="agent-start-codex"
							className="rounded-md px-1.5 py-0.5 text-[11.5px] text-[var(--color-icon-tertiary)] hover:text-[var(--color-text-secondary)]"
						>
							Use Codex instead
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
