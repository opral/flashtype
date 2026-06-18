import { useCallback, useState, type JSX } from "react";
import { Files, FolderOpen, Zap } from "lucide-react";
import { TopBar } from "./top-bar";
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
	isUpdateReady,
	onInstallUpdate,
}: {
	/** Called with a path for dropped folders, without one for the picker. */
	readonly onOpenFolder: (path?: string) => Promise<void>;
	readonly isUpdateReady?: boolean;
	readonly onInstallUpdate?: () => void | Promise<void>;
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
				isUpdateReady={isUpdateReady}
				onInstallUpdate={onInstallUpdate}
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
				<Island
					className={`flex-50 transition-[background-color,box-shadow] duration-150 ${
						isDropTarget
							? "bg-brand-50/45 shadow-[inset_0_0_0_2px_rgba(251,146,60,0.38)]"
							: ""
					}`}
				>
					<IslandTabRow>
						<AddViewButton />
					</IslandTabRow>
					<div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
						<div className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100">
							<FolderOpen className="size-4.5" strokeWidth={2.2} />
						</div>
						<h1 className="mt-4 text-[18px] font-bold text-neutral-900">
							Open a folder
						</h1>
						<p className="mt-1.5 max-w-78 text-[13px] leading-relaxed text-ink-muted text-pretty">
							Choose a local repo, docs folder, or notes folder. Flashtype keeps
							everything in plain markdown files.
						</p>
						<button
							type="button"
							onClick={() => void onOpenFolder()}
							className={`mt-5 flex h-8.5 items-center gap-2 rounded-lg bg-brand-600 px-4.5 text-[12.5px] font-bold text-neutral-0 shadow-[0_5px_14px_rgba(232,89,12,0.24),inset_0_1px_0_rgba(255,255,255,0.2)] transition hover:bg-brand-700 ${
								isDropTarget ? "brightness-[1.06]" : ""
							}`}
						>
							Open folder
							<span className="rounded-[4px] bg-white/15 px-1.25 py-0.25 text-[11px] font-semibold leading-none text-white/80">
								⌘O
							</span>
						</button>
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
		</div>
	);
}
