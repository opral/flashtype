import { useCallback, useState, type JSX } from "react";
import { Files, Zap } from "lucide-react";
import { TopBar } from "./top-bar";
import { StatusBar } from "./status-bar";
import { AddViewButton, Island, IslandTabRow, TabChip } from "./island";
import { AgentInvite } from "./agent-invite";

/**
 * First-run state: no workspace is open, so nothing else exists yet — no
 * database, no files, no agent. The screen has exactly one job: get the user
 * to open a folder (button, ⌘O — handled globally by AppRoot — or dropping a
 * folder anywhere on the window).
 *
 * @example
 * <FirstRunScreen onOpenFolder={(path) => openWorkspace(path)} />
 */
export function FirstRunScreen({
	onOpenFolder,
}: {
	/** Called with a path for dropped folders, without one for the picker. */
	readonly onOpenFolder: (path?: string) => Promise<void>;
}): JSX.Element {
	const [isDropTarget, setIsDropTarget] = useState(false);

	const handleDrop = useCallback(
		(event: React.DragEvent) => {
			event.preventDefault();
			setIsDropTarget(false);
			const file = event.dataTransfer.files[0];
			if (!file) return;
			const path = window.flashtypeDesktop?.workspace.getPathForFile(file);
			if (!path) return;
			void onOpenFolder(path);
		},
		[onOpenFolder],
	);

	return (
		<div
			data-testid="first-run-screen"
			className="flex h-dvh flex-col bg-shell text-neutral-900"
			onDragOver={(event) => {
				event.preventDefault();
				setIsDropTarget(true);
			}}
			onDragLeave={(event) => {
				if (event.currentTarget === event.target) setIsDropTarget(false);
			}}
			onDrop={handleDrop}
		>
			<TopBar
				menu={
					<span className="flex h-7 w-7 items-center justify-center rounded-[7px]">
						<Zap className="size-3.75 fill-brand-600 text-brand-600" />
					</span>
				}
			/>
			<div className="flex min-h-0 flex-1 gap-1.75 px-2">
				<Island className="flex-20">
					<IslandTabRow>
						<TabChip icon={<Files strokeWidth={2} />} label="Files" />
						<AddViewButton />
					</IslandTabRow>
					<div className="flex flex-1 items-center justify-center">
						<span className="text-[12.5px] text-ink-faint">No folder open</span>
					</div>
				</Island>
				<Island className="flex-50">
					<IslandTabRow>
						<AddViewButton />
					</IslandTabRow>
					<div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
						<Zap className="size-6.5 fill-brand-600 text-brand-600" />
						<h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-neutral-900">
							Open a folder
						</h1>
						<p className="mt-1.5 max-w-85 text-sm leading-relaxed text-ink-muted text-pretty">
							Flashtype works on a folder on your disk — your notes, docs, or a
							repo. Everything stays in plain markdown files.
						</p>
						<button
							type="button"
							onClick={() => void onOpenFolder()}
							className={`mt-6 flex items-center gap-2 rounded-[10px] bg-linear-to-b from-brand-500 to-brand-600 px-6 py-2.75 text-sm font-bold text-neutral-0 shadow-[0_6px_18px_rgba(232,89,12,0.32),inset_0_1px_0_rgba(255,255,255,0.25)] hover:brightness-[1.06] ${
								isDropTarget ? "brightness-[1.06]" : ""
							}`}
						>
							Open folder…
							<span className="text-[11.5px] font-semibold opacity-75">⌘O</span>
						</button>
						<p className="mt-4.5 text-[12.5px] text-neutral-400">
							or drop a folder anywhere in this window
						</p>
					</div>
				</Island>
				<Island className="flex-30">
					<IslandTabRow>
						<AddViewButton />
					</IslandTabRow>
					{/* Copy only: agent CTAs appear once a folder is open. */}
					<AgentInvite />
				</Island>
			</div>
			<StatusBar left={<span>Ready</span>} />
		</div>
	);
}
