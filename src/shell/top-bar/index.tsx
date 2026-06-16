import { useMemo, useState, type ReactNode } from "react";
import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export type TopBarProps = {
	/** Shown as the macOS-style proxy title in the header center. */
	readonly workspaceName?: string | null;
	/** Active document name, shown after the workspace as a breadcrumb. */
	readonly activeFileName?: string | null;
	/** Leading slot, e.g. the Flashtype menu. Must not require lix. */
	readonly menu?: ReactNode;
	/** Clicking the proxy title opens the directory picker to switch workspaces. */
	readonly onWorkspaceTitleClick?: () => void;
	readonly onToggleLeftSidebar?: () => void;
	readonly onToggleRightSidebar?: () => void;
	readonly isLeftSidebarVisible?: boolean;
	readonly isRightSidebarVisible?: boolean;
	readonly isUpdateReady?: boolean;
	readonly onInstallUpdate?: () => void | Promise<void>;
};

/**
 * Window header: drag region with the bolt menu, panel toggles, the workspace
 * proxy title, and outbound links. Renders without lix so the first-run
 * screen can share it.
 *
 * @example
 * <TopBar workspaceName="blog" menu={<FlashtypeMenu />} />
 */
export function TopBar({
	workspaceName = null,
	activeFileName = null,
	menu,
	onWorkspaceTitleClick,
	onToggleLeftSidebar,
	onToggleRightSidebar,
	isLeftSidebarVisible = true,
	isRightSidebarVisible = true,
	isUpdateReady = false,
	onInstallUpdate,
}: TopBarProps) {
	const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
	const isMacPlatform = useMemo(() => {
		if (typeof navigator === "undefined") return false;
		const platformCandidates = [
			((navigator as any).userAgentData?.platform as string | undefined) ??
				null,
			navigator.platform ?? null,
			navigator.userAgent ?? null,
		].filter(Boolean) as string[];
		const combined = platformCandidates.join(" ").toLowerCase();
		return /mac|iphone|ipad|ipod/.test(combined);
	}, []);

	const modifierKey = isMacPlatform ? "⌘" : "Ctrl";
	const leftShortcut = isMacPlatform ? `${modifierKey}1` : `${modifierKey}+1`;
	const rightShortcut = isMacPlatform ? `${modifierKey}3` : `${modifierKey}+3`;
	const showUpdateButton = isUpdateReady && Boolean(onInstallUpdate);

	const handleInstallUpdate = async () => {
		if (!onInstallUpdate || isInstallingUpdate) return;
		setIsInstallingUpdate(true);
		try {
			await onInstallUpdate();
		} finally {
			setIsInstallingUpdate(false);
		}
	};

	return (
		<header className="relative flex h-9 shrink-0 items-center px-3 text-ink-muted [-webkit-app-region:drag]">
			<div
				className={`flex min-w-0 flex-1 items-center gap-1 text-sm ${
					isMacPlatform ? "pl-[68px]" : ""
				}`}
			>
				{menu}
				<Tooltip delayDuration={500}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-[7px] text-ink-muted hover:bg-hover-soft hover:text-neutral-900 [-webkit-app-region:no-drag]"
							type="button"
							onClick={onToggleLeftSidebar}
							aria-label="Toggle left panel"
							aria-pressed={isLeftSidebarVisible}
							data-state={isLeftSidebarVisible ? "on" : "off"}
						>
							<PanelToggleIcon side="left" isActive={isLeftSidebarVisible} />
						</Button>
					</TooltipTrigger>
					<TooltipContent className="bg-neutral-900 text-neutral-0 [&_[class*='bg-secondary']]:bg-neutral-900 [&_[class*='fill-secondary']]:fill-neutral-900">
						Toggle left panel ({leftShortcut})
					</TooltipContent>
				</Tooltip>
				<Tooltip delayDuration={500}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-[7px] text-ink-muted hover:bg-hover-soft hover:text-neutral-900 [-webkit-app-region:no-drag]"
							type="button"
							onClick={onToggleRightSidebar}
							aria-label="Toggle right panel"
							aria-pressed={isRightSidebarVisible}
							data-state={isRightSidebarVisible ? "on" : "off"}
						>
							<PanelToggleIcon side="right" isActive={isRightSidebarVisible} />
						</Button>
					</TooltipTrigger>
					<TooltipContent className="bg-neutral-900 text-neutral-0 [&_[class*='bg-secondary']]:bg-neutral-900 [&_[class*='fill-secondary']]:fill-neutral-900">
						Toggle right panel ({rightShortcut})
					</TooltipContent>
				</Tooltip>
			</div>
			{workspaceName ? (
				<div className="pointer-events-none absolute inset-x-0 flex min-w-0 items-center justify-center px-[88px]">
					<div className="pointer-events-auto flex min-w-0 items-center text-[12.5px] [-webkit-app-region:no-drag]">
						<button
							type="button"
							onClick={onWorkspaceTitleClick}
							disabled={!onWorkspaceTitleClick}
							title="Switch workspace"
							className={`flex h-7 min-w-0 items-center gap-1.5 rounded-[7px] px-2 enabled:hover:bg-hover-soft ${
								activeFileName
									? "font-medium text-ink-muted"
									: "font-semibold text-neutral-700"
							}`}
						>
							<Folder className="size-3.25 text-ink-muted" strokeWidth={2} />
							<span className="max-w-60 truncate">{workspaceName}</span>
						</button>
						{activeFileName ? (
							<>
								<span className="mx-0.5 shrink-0 text-neutral-300">/</span>
								<span className="max-w-60 truncate px-1 font-semibold text-neutral-900">
									{activeFileName}
								</span>
							</>
						) : null}
					</div>
				</div>
			) : null}
			<div className="flex flex-1 items-center justify-end gap-1.5">
				{showUpdateButton ? (
					<Button
						type="button"
						className="h-6 rounded-md bg-linear-to-b from-brand-500 to-brand-600 px-2.5 text-[11.5px] font-bold text-neutral-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_2px_rgba(123,62,27,0.16)] hover:brightness-[1.06] [-webkit-app-region:no-drag]"
						disabled={isInstallingUpdate}
						onClick={() => {
							void handleInstallUpdate();
						}}
						aria-label="Install update"
					>
						Update
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="icon"
					className="h-7 w-7 rounded-[7px] text-chrome-icon hover:bg-hover-soft hover:text-neutral-900 [-webkit-app-region:no-drag]"
					asChild
				>
					<a
						href="https://github.com/opral/flashtype"
						target="_blank"
						rel="noreferrer"
						title="GitHub"
					>
						<svg
							className="size-3.75"
							fill="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								fillRule="evenodd"
								d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
								clipRule="evenodd"
							/>
						</svg>
					</a>
				</Button>
			</div>
		</header>
	);
}

type PanelToggleIconProps = {
	readonly side: "left" | "right";
	readonly isActive: boolean;
};

function PanelToggleIcon({ side, isActive }: PanelToggleIconProps) {
	const viewBoxPath = side === "left" ? "M9 3v18" : "M15 3v18";
	const panelRect = side === "left" ? { x: 3, width: 6 } : { x: 15, width: 6 };
	return (
		<svg
			aria-hidden="true"
			className="size-3.75 text-current"
			focusable="false"
			role="img"
			viewBox="0 0 24 24"
		>
			{isActive ? (
				<rect
					{...panelRect}
					y="3"
					height="18"
					rx="1.2"
					fill="currentColor"
					fillOpacity={0.4}
				/>
			) : null}
			<rect
				width="18"
				height="18"
				x="3"
				y="3"
				rx="2"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d={viewBoxPath}
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
