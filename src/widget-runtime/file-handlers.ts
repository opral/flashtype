import type { WidgetDefinition } from "./types";

export const EXTERNAL_WRITE_REVIEWABLE_FILE_EXTENSIONS = [
	"md",
	"markdown",
	"csv",
] as const;

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

export function fileExtensionFromPath(filePath: string): string | undefined {
	const name = filePath.split("/").pop() ?? filePath;
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === name.length - 1) return undefined;
	return name.slice(dotIndex + 1).toLowerCase();
}

export function isMarkdownFilePath(filePath: string): boolean {
	const extension = fileExtensionFromPath(filePath);
	return extension === "md" || extension === "markdown";
}

export function isCsvFilePath(filePath: string): boolean {
	return fileExtensionFromPath(filePath) === "csv";
}

export function isExternalWriteReviewableFilePath(filePath: string): boolean {
	const extension = fileExtensionFromPath(filePath);
	return (
		extension !== undefined &&
		EXTERNAL_WRITE_REVIEWABLE_FILE_EXTENSIONS.includes(
			extension as (typeof EXTERNAL_WRITE_REVIEWABLE_FILE_EXTENSIONS)[number],
		)
	);
}

export function findFileHandlerWidget(
	widgets: Iterable<WidgetDefinition>,
	filePath: string,
): WidgetDefinition | undefined {
	const extension = fileExtensionFromPath(filePath);
	if (!extension) return undefined;
	for (const widget of widgets) {
		const fileExtensions = normalizeFileExtensions(widget.fileExtensions);
		if (fileExtensions?.includes(extension)) {
			return widget;
		}
	}
	return undefined;
}
