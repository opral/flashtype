import mermaid from "mermaid";

let initialized = false;
let renderCounter = 0;
let activeTheme: "dark" | "default" | null = null;
let themeObserver: MutationObserver | null = null;
const themeChangeListeners = new Set<() => void>();

function isDarkMode(): boolean {
	return document.documentElement.classList.contains("dark");
}

function currentTheme(): "dark" | "default" {
	return isDarkMode() ? "dark" : "default";
}

function ensureThemeObserver(): void {
	if (themeObserver || typeof document === "undefined") return;
	themeObserver = new MutationObserver(() => {
		const theme = currentTheme();
		if (theme === activeTheme) return;
		syncMermaidTheme();
		for (const listener of themeChangeListeners) {
			listener();
		}
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
}

export function getMermaidRenderTheme(): "dark" | "default" {
	ensureThemeObserver();
	return currentTheme();
}

export function onMermaidThemeChange(listener: () => void): () => void {
	ensureThemeObserver();
	themeChangeListeners.add(listener);
	return () => {
		themeChangeListeners.delete(listener);
	};
}

function syncMermaidTheme(): void {
	const theme = currentTheme();
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme,
	});
	initialized = true;
	activeTheme = theme;
}

function ensureMermaidInitialized(): void {
	if (!initialized || currentTheme() !== activeTheme) {
		syncMermaidTheme();
	}
}

export function resetMermaidForTests(): void {
	initialized = false;
	renderCounter = 0;
	activeTheme = null;
	themeObserver?.disconnect();
	themeObserver = null;
	themeChangeListeners.clear();
}

export async function renderMermaidDiagram(
	source: string,
	container: HTMLElement,
): Promise<void> {
	const trimmed = source.trim();
	container.replaceChildren();
	if (!trimmed) {
		return;
	}

	ensureMermaidInitialized();
	const renderId = `flashtype-mermaid-${++renderCounter}`;
	const { svg } = await mermaid.render(renderId, trimmed);
	const wrapper = document.createElement("div");
	wrapper.innerHTML = svg;
	container.appendChild(wrapper);
}
