import { useCallback, useState, type JSX } from "react";
import {
	ClipboardPaste,
	FilePlus,
	FolderOpen,
	Files,
	TerminalSquare,
	Zap,
} from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import type { WidgetContext } from "../widget-runtime/types";
import {
	FILES_WIDGET_KIND,
	TERMINAL_WIDGET_KIND,
} from "../widget-runtime/widget-instance-helpers";
import { importFromClipboard, importFromComputer } from "./import-file";
import { seedStarterContent } from "@/seed";

type LandingScreenProps = {
	readonly context: WidgetContext;
	readonly onCreateNewFile?: () => void | Promise<void>;
	readonly isPanelFocused: boolean;
};

function LandingScreenContent({
	context,
	onCreateNewFile,
	isPanelFocused: _isPanelFocused,
}: LandingScreenProps): JSX.Element {
	const [isSeeding, setIsSeeding] = useState(false);

	const openFilesView = useCallback(() => {
		context.openWidget?.({
			panel: "central",
			kind: FILES_WIDGET_KIND,
			focus: true,
		});
	}, [context]);

	const handleCreateNewFile = useCallback(async () => {
		if (!onCreateNewFile) return;
		await onCreateNewFile();
	}, [onCreateNewFile]);

	const handlePasteFromClipboard = useCallback(async () => {
		try {
			await importFromClipboard(context);
		} catch (error) {
			console.error("Failed to paste from clipboard:", error);
		}
	}, [context]);

	const handleOpenFileFromComputer = useCallback(async () => {
		try {
			await importFromComputer(context);
		} catch (error) {
			console.error("Failed to open file:", error);
		}
	}, [context]);

	const handleOpenTerminal = useCallback(() => {
		context.openWidget?.({
			panel: "central",
			kind: TERMINAL_WIDGET_KIND,
			focus: true,
		});
	}, [context]);

	const handleSeedStarterFiles = useCallback(async () => {
		if (isSeeding) return;
		setIsSeeding(true);
		try {
			await seedStarterContent(context.lix);
		} catch (error) {
			console.error("Failed to seed starter files:", error);
		} finally {
			setIsSeeding(false);
		}
	}, [context.lix, isSeeding]);

	return (
		<div
			className="relative flex h-full w-full flex-col items-center px-6 text-neutral-900"
			data-testid="landing-screen"
		>
			<a
				href="https://lix.dev"
				target="_blank"
				rel="noopener noreferrer"
				className="-translate-x-1/2 absolute left-1/2 top-6 sm:top-12 flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-5 py-1.5 text-sm"
			>
				<Zap className="h-3.5 w-3.5 text-brand-600" />
				<span className="font-semibold text-neutral-900">flashtype.com</span>
			</a>

			<main className="flex h-full w-full max-w-3xl flex-col items-center justify-center gap-8 py-20 sm:py-24 text-center">
				<div className="flex flex-col items-center gap-2">
					<h1 className="text-4xl font-semibold text-neutral-900">
						Start writing
					</h1>
					<p className="text-base text-neutral-600">
						Open files and edit markdown directly in Flashtype.
					</p>
				</div>

				<div className="flex flex-wrap items-center justify-center gap-4">
					<ActionButton
						icon={<Files className="size-6" />}
						label="Open files view"
						onClick={openFilesView}
						ariaLabel="Open files view"
					/>
					{onCreateNewFile && (
						<ActionButton
							icon={<Zap className="size-6" />}
							label="Create new file"
							onClick={handleCreateNewFile}
							ariaLabel="Create new file"
						/>
					)}
					<ActionButton
						icon={<ClipboardPaste className="size-6" />}
						label="Paste from clipboard"
						onClick={handlePasteFromClipboard}
						ariaLabel="Paste markdown from clipboard"
					/>
					<ActionButton
						icon={<FolderOpen className="size-6" />}
						label="Open file from computer"
						onClick={handleOpenFileFromComputer}
						ariaLabel="Open file from computer"
					/>
					<ActionButton
						icon={<TerminalSquare className="size-6" />}
						label="Open terminal"
						onClick={handleOpenTerminal}
						ariaLabel="Open terminal"
					/>
					<ActionButton
						icon={<FilePlus className="size-6" />}
						label={
							isSeeding ? "Seeding starter files..." : "Seed starter files"
						}
						onClick={() => {
							void handleSeedStarterFiles();
						}}
						ariaLabel="Seed starter files"
						disabled={isSeeding}
					/>
				</div>
			</main>
		</div>
	);
}

export function LandingScreen({
	context,
	onCreateNewFile,
	isPanelFocused,
}: LandingScreenProps): JSX.Element {
	return (
		<LandingScreenContent
			context={context}
			onCreateNewFile={onCreateNewFile}
			isPanelFocused={isPanelFocused}
		/>
	);
}
