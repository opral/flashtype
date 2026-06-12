import type { WidgetDefinition } from "./types";

export function normalizeFileExtension(extension: string): string | undefined {
	const normalized = extension.trim().replace(/^\./, "").toLowerCase();
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeFileExtensions(
	extensions: readonly string[] | undefined,
): string[] | undefined {
	if (!extensions) return undefined;
	const normalized = extensions
		.map(normalizeFileExtension)
		.filter((extension): extension is string => extension !== undefined);
	return normalized.length > 0 ? normalized : undefined;
}

export function findFileHandlerWidget(
	widgets: Iterable<WidgetDefinition>,
	filePath: string,
): WidgetDefinition | undefined {
	const extension = filePath.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
	if (!extension) return undefined;
	for (const widget of widgets) {
		const fileExtensions = normalizeFileExtensions(widget.fileExtensions);
		if (fileExtensions?.includes(extension)) {
			return widget;
		}
	}
	return undefined;
}
