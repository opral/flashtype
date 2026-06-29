type MermaidModule = typeof import("mermaid");

let mermaidModulePromise: Promise<MermaidModule["default"]> | null = null;
let initialized = false;
let renderCounter = 0;

function isDarkMode(): boolean {
	return document.documentElement.classList.contains("dark");
}

async function getMermaid(): Promise<MermaidModule["default"]> {
	if (!mermaidModulePromise) {
		mermaidModulePromise = import("mermaid").then((module) => module.default);
	}
	return mermaidModulePromise;
}

async function ensureMermaidInitialized(): Promise<MermaidModule["default"]> {
	const mermaid = await getMermaid();
	if (!initialized) {
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: isDarkMode() ? "dark" : "default",
		});
		initialized = true;
	}
	return mermaid;
}

export function resetMermaidForTests(): void {
	initialized = false;
	mermaidModulePromise = null;
}

export function nextMermaidRenderId(prefix = "mermaid"): string {
	renderCounter += 1;
	return `${prefix}-${renderCounter}`;
}

export async function renderMermaidDiagram(
	source: string,
	renderId: string,
): Promise<string> {
	const trimmed = source.trim();
	if (!trimmed) {
		return "";
	}

	const mermaid = await ensureMermaidInitialized();
	const { svg } = await mermaid.render(renderId, trimmed);
	return svg;
}
