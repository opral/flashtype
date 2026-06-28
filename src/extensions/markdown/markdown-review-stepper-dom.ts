// DOM helpers for the per-change review stepper: locating and revealing the
// blocks a change touches inside the static diff, and the platform shortcut hint.

export function highlightTargets(
	container: HTMLElement,
	change: {
		beforeBlockIds: readonly string[];
		afterBlockIds: readonly string[];
	},
): HTMLElement[] {
	const ids = new Set([...change.beforeBlockIds, ...change.afterBlockIds]);
	const targets: HTMLElement[] = [];
	for (const id of ids) {
		const escaped = cssEscape(id);
		const selector = `[data-diff-key="${escaped}"], [data-diff-key^="${escaped}:"]`;
		for (const element of container.querySelectorAll(selector)) {
			if (element instanceof HTMLElement && !targets.includes(element)) {
				targets.push(element);
			}
		}
	}
	return targets;
}

export function revealIfNeeded(container: HTMLElement, target: HTMLElement): void {
	const containerRect = container.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	const fullyVisible =
		targetRect.top >= containerRect.top &&
		targetRect.bottom <= containerRect.bottom;
	if (fullyVisible) return;
	target.scrollIntoView({ block: "nearest", behavior: "auto" });
}

export function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function cssEscape(value: string): string {
	const cssApi = (globalThis as { CSS?: { escape?: (value: string) => string } })
		.CSS;
	if (cssApi?.escape) return cssApi.escape(value);
	return value.replace(/["\\]/g, "\\$&");
}
