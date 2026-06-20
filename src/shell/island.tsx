import type { JSX, ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shell primitives for the islands UI: a white rounded panel with a uniform
 * 40px tab row. Every island renders the same chrome so content always starts
 * at the same vertical offset.
 *
 * @example
 * <Island>
 *   <IslandTabRow>
 *     <TabChip icon={<Files />} label="Files" isActive />
 *     <AddViewButton onClick={onAdd} />
 *   </IslandTabRow>
 *   <div className="flex-1 min-h-0">…</div>
 * </Island>
 */
export function Island({
	className,
	children,
}: {
	readonly className?: string;
	readonly children: ReactNode;
}): JSX.Element {
	return (
		<div
			className={cn(
				"flex h-full min-w-0 flex-col overflow-hidden rounded-[10px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)]",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function IslandTabRow({
	children,
}: {
	readonly children?: ReactNode;
}): JSX.Element {
	return (
		<div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border-subtle)] px-2">
			{children}
		</div>
	);
}

export function TabChip({
	icon,
	label,
	isFocused = false,
	onClick,
	trailing,
}: {
	readonly icon?: ReactNode;
	readonly label: string;
	/** Exactly one chip on screen is focused (receives keyboard input). */
	readonly isFocused?: boolean;
	readonly onClick?: () => void;
	readonly trailing?: ReactNode;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex h-7 items-center gap-1.5 rounded-[7px] px-2.25 text-xs font-semibold text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]",
				isFocused
					? "bg-[var(--color-bg-selection-current)] ring-1 ring-inset ring-[var(--color-border-selection-current)] [&_svg]:text-[var(--color-icon-selection-current)]"
					: "bg-[var(--color-bg-hover)] [&_svg]:text-[var(--color-icon-secondary)]",
			)}
		>
			{icon ? <span className="[&_svg]:size-3.25">{icon}</span> : null}
			{label}
			{trailing}
		</button>
	);
}

export function AddViewButton({
	onClick,
	"aria-label": ariaLabel = "Add view",
}: {
	readonly onClick?: () => void;
	readonly "aria-label"?: string;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			className="flex size-6 items-center justify-center rounded-md text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-icon-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]"
		>
			<Plus className="size-3.25" strokeWidth={2} />
		</button>
	);
}
