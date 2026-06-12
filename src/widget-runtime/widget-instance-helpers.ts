import { isMarkdownFilePath } from "@/lib/path";
import type { DiffWidgetConfig, WidgetKind } from "./types";
import type { WidgetInstance } from "./types";

export const FILES_WIDGET_KIND = "flashtype_files" as WidgetKind;
export const FILE_WIDGET_KIND = "flashtype_file" as WidgetKind;
export const CSV_WIDGET_KIND = "flashtype_csv" as WidgetKind;
export const DIFF_WIDGET_KIND = "flashtype_diff" as WidgetKind;
export const TERMINAL_WIDGET_KIND = "flashtype_terminal" as WidgetKind;

export const fileWidgetInstanceForKind = (
	kind: WidgetKind,
	fileId: string,
): string => `${kind}:${fileId}`;

export const fileWidgetInstance = (fileId: string): string =>
	fileWidgetInstanceForKind(FILE_WIDGET_KIND, fileId);

export const diffWidgetInstance = (fileId: string): string =>
	`${DIFF_WIDGET_KIND}:${fileId}`;

export function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function diffLabelFromPath(filePath?: string): string | undefined {
	if (!filePath) return undefined;
	const encodedLabel = filePath.split("/").filter(Boolean).pop();
	return encodedLabel ? decodeURIComponentSafe(encodedLabel) : undefined;
}

export function fileLabelFromPath(
	filePath?: string,
	fallbackLabel?: string,
): string {
	const derived = diffLabelFromPath(filePath);
	if (derived) return derived;
	if (filePath) return filePath;
	return fallbackLabel ?? "Untitled";
}

export function buildFileWidgetProps(args: {
	fileId: string;
	filePath?: string;
	label?: string;
}) {
	const label = args.label ?? fileLabelFromPath(args.filePath, args.fileId);
	return args.filePath
		? {
				fileId: args.fileId,
				filePath: args.filePath,
				flashtype: { label },
			}
		: { fileId: args.fileId, flashtype: { label } };
}

export function buildDiffWidgetProps(args: {
	fileId: string;
	filePath: string;
	label?: string;
	diffConfig?: DiffWidgetConfig;
}) {
	const label = args.label ?? diffLabelFromPath(args.filePath) ?? args.filePath;
	return {
		fileId: args.fileId,
		filePath: args.filePath,
		flashtype: { label },
		...(args.diffConfig ? { diff: args.diffConfig } : {}),
	};
}

export function activeMarkdownFileIdFromWidgetInstance(
	entry: WidgetInstance | null | undefined,
): string | null {
	if (entry?.kind !== FILE_WIDGET_KIND) return null;
	if (typeof entry.state?.fileId !== "string") return null;
	if (typeof entry.state.filePath !== "string") return null;
	if (!isMarkdownFilePath(entry.state.filePath)) return null;
	return entry.state.fileId;
}
