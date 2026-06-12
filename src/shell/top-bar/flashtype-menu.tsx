import {
	Circle,
	CircleOff,
	FileDown,
	Hammer,
	Moon,
	Sun,
	Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useLix } from "@/lib/lix-react";
import { useCallback } from "react";
import { useKeyValue } from "@/hooks/key-value/use-key-value";

/**
 * Dropdown launcher for flashtype developer utilities.
 *
 * @example
 * <FlashtypeMenu />
 */
export function FlashtypeMenu() {
	const lix = useLix();
	const [themePreference, setThemePreference] = useKeyValue("flashtype_theme");
	const [deterministicMode, setDeterministicMode] = useKeyValue(
		"lix_deterministic_mode" as any,
		{
			defaultBranchId: "global",
			untracked: true,
		},
	) as [
		{ enabled?: boolean } | null,
		(value: { enabled: boolean }) => Promise<void>,
	];

	const deterministicEnabled = Boolean(deterministicMode?.enabled);
	const isDarkMode = themePreference === "dark";

	const toggleDeterministicMode = useCallback(async () => {
		await setDeterministicMode({ enabled: !deterministicEnabled });
	}, [deterministicEnabled, setDeterministicMode]);

	const toggleThemeMode = useCallback(async () => {
		await setThemePreference(isDarkMode ? "light" : "dark");
	}, [isDarkMode, setThemePreference]);

	const handleExportLix = async () => {
		if (!lix) return;
		try {
			const snapshotBytes = await lix.exportSnapshot();
			const blob = new Blob([new Uint8Array(snapshotBytes)], {
				type: "application/octet-stream",
			});
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `flashtype-export-${new Date()
				.toISOString()
				.slice(0, 10)}.lix`;
			document.body.appendChild(anchor);
			anchor.click();
			window.setTimeout(() => {
				document.body.removeChild(anchor);
				URL.revokeObjectURL(url);
			}, 100);
		} catch (error) {
			console.error("Failed to export Lix blob", error);
		}
	};

	// Inspector is intentionally disabled for now to reduce merge conflicts.
	// const handleToggleInspector = async () => {
	// 	try {
	// 		await toggleLixInspector();
	// 	} catch (error) {
	// 		console.error("Failed to toggle Lix Inspector", error);
	// 	}
	// };

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 data-[state=open]:bg-neutral-200 data-[state=open]:text-neutral-900 [-webkit-app-region:no-drag]"
				>
					<Zap className="size-4 text-brand-600" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-48 rounded-lg text-sm"
				align="start"
				side="bottom"
				sideOffset={6}
			>
				<DropdownMenuItem
					className="flex items-center gap-1.5 text-xs"
					onSelect={() => {
						void handleExportLix();
					}}
				>
					<FileDown className="h-3.5 w-3.5 shrink-0" />
					<span>Export lix file</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					className="flex items-center gap-1.5 text-xs"
					onSelect={() => {
						void toggleThemeMode();
					}}
				>
					{isDarkMode ? (
						<Sun className="h-3.5 w-3.5 shrink-0" />
					) : (
						<Moon className="h-3.5 w-3.5 shrink-0" />
					)}
					<span>
						{isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
					</span>
				</DropdownMenuItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger className="flex items-center gap-1.5 text-xs">
						<Hammer className="h-3.5 w-3.5 shrink-0" />
						<span>Developer tools</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="min-w-56 text-xs">
						{/* <DropdownMenuItem
							className="gap-1.5 text-xs"
							onSelect={() => {
								void handleToggleInspector();
							}}
						>
							<Search className="h-3.5 w-3.5" />
							<span>Toggle Lix Inspector</span>
						</DropdownMenuItem> */}
						<DropdownMenuItem
							className="gap-1.5 text-xs"
							onSelect={() => {
								void toggleDeterministicMode();
							}}
						>
							{deterministicEnabled ? (
								<CircleOff className="h-3.5 w-3.5" />
							) : (
								<Circle className="h-3.5 w-3.5" />
							)}
							<span>
								{deterministicEnabled
									? "Turn off deterministic mode"
									: "Turn on deterministic mode"}
							</span>
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
