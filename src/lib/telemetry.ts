type TelemetryEventName = NonNullable<
	Window["flashtypeDesktop"]
>["telemetry"] extends { capture(payload: infer Payload): Promise<unknown> }
	? Payload extends { event: infer EventName }
		? EventName
		: never
	: never;

type TelemetryProperties = Record<
	string,
	| string
	| number
	| boolean
	| Record<string, number>
	| undefined
>;

const throttledTelemetryEvents = new Map<string, number>();
const SAFE_FILE_EXTENSIONS = new Set([
	"bash",
	"c",
	"cc",
	"cjs",
	"cpp",
	"cs",
	"css",
	"csv",
	"cxx",
	"doc",
	"docx",
	"env",
	"fish",
	"gif",
	"go",
	"gql",
	"graphql",
	"gz",
	"h",
	"htm",
	"html",
	"ini",
	"java",
	"jpeg",
	"jpg",
	"js",
	"json",
	"jsonl",
	"jsx",
	"kt",
	"kts",
	"lock",
	"markdown",
	"md",
	"mjs",
	"pdf",
	"php",
	"png",
	"ppt",
	"pptx",
	"py",
	"rb",
	"rs",
	"sh",
	"sql",
	"svg",
	"swift",
	"toml",
	"ts",
	"tsx",
	"tsv",
	"txt",
	"webp",
	"xls",
	"xlsx",
	"xml",
	"yaml",
	"yml",
	"zsh",
]);

export function captureTelemetry(
	event: TelemetryEventName,
	properties: TelemetryProperties = {},
) {
	void captureTelemetryAsync(event, properties).catch((error: unknown) => {
		console.warn("Failed to capture telemetry", error);
	});
}

export async function captureTelemetryAsync(
	event: TelemetryEventName,
	properties: TelemetryProperties = {},
) {
	return await window.flashtypeDesktop?.telemetry?.capture({
		event,
		properties,
	});
}

export function captureTelemetryThrottled(
	key: string,
	event: TelemetryEventName,
	properties: TelemetryProperties = {},
	throttleMs = 5 * 60 * 1000,
) {
	const now = Date.now();
	const lastCapturedAt = throttledTelemetryEvents.get(key) ?? 0;
	if (now - lastCapturedAt < throttleMs) {
		return;
	}
	throttledTelemetryEvents.set(key, now);
	captureTelemetry(event, properties);
}

export function fileExtensionProperty(filePath: string | null | undefined) {
	if (!filePath) {
		return undefined;
	}
	const fileName = filePath.split("/").pop() ?? filePath;
	const match = fileName.match(/\.([^./]+)$/);
	if (!match?.[1]) {
		return "none";
	}
	return normalizeTelemetryFileExtension(match[1]);
}

export function normalizeTelemetryFileExtension(extension: string) {
	const normalized = extension.trim().toLowerCase();
	return SAFE_FILE_EXTENSIONS.has(normalized) ? normalized : "other";
}

export async function shouldProfileWorkspace(lixId: string) {
	return await window.flashtypeDesktop?.telemetry?.shouldProfileWorkspace({
		lixId,
	});
}

export async function markWorkspaceProfiled(lixId: string) {
	return await window.flashtypeDesktop?.telemetry?.markWorkspaceProfiled({
		lixId,
	});
}
