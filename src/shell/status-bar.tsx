import type { JSX, ReactNode } from "react";

/**
 * Bottom status ribbon. Left carries workspace status (git branch, or
 * "Ready" on first run); right carries document info.
 *
 * @example
 * <StatusBar left={<BranchSwitcher />} right={<span>1,240 words</span>} />
 */
export function StatusBar({
	left,
	right,
}: {
	readonly left?: ReactNode;
	readonly right?: ReactNode;
}): JSX.Element {
	return (
		<footer className="flex h-7.5 shrink-0 items-center justify-between px-3 text-[11.5px] text-chrome-icon">
			<div className="flex min-w-0 items-center gap-1.5">{left}</div>
			<div className="flex min-w-0 items-center gap-1.5">{right}</div>
		</footer>
	);
}
