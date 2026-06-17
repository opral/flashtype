import { isMarkdownFilePath } from "./file-handlers";
import type { DiffExtensionConfig, ExtensionKind } from "./types";
import type { ExtensionInstance } from "./types";

export const FILES_EXTENSION_KIND = "flashtype_files" as ExtensionKind;
export const FILE_EXTENSION_KIND = "flashtype_file" as ExtensionKind;
export const CSV_EXTENSION_KIND = "flashtype_csv" as ExtensionKind;
export const DIFF_EXTENSION_KIND = "flashtype_diff" as ExtensionKind;
export const TERMINAL_EXTENSION_KIND = "flashtype_terminal" as ExtensionKind;

export const fileExtensionInstanceForKind = (
	kind: ExtensionKind,
	fileId: string,
): string => `${kind}:${fileId}`;

export const fileExtensionInstance = (fileId: string): string =>
	fileExtensionInstanceForKind(FILE_EXTENSION_KIND, fileId);

export const diffExtensionInstance = (fileId: string): string =>
	`${DIFF_EXTENSION_KIND}:${fileId}`;

export function diffLabelFromPath(filePath?: string): string | undefined {
	if (!filePath) return undefined;
	return filePath.split("/").filter(Boolean).pop();
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

export function buildFileExtensionProps(args: {
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

export function buildDiffExtensionProps(args: {
	fileId: string;
	filePath: string;
	label?: string;
	diffConfig?: DiffExtensionConfig;
}) {
	const label = args.label ?? diffLabelFromPath(args.filePath) ?? args.filePath;
	return {
		fileId: args.fileId,
		filePath: args.filePath,
		flashtype: { label },
		...(args.diffConfig ? { diff: args.diffConfig } : {}),
	};
}

export function activeMarkdownFileIdFromExtensionInstance(
	entry: ExtensionInstance | null | undefined,
): string | null {
	if (entry?.kind !== FILE_EXTENSION_KIND) return null;
	if (typeof entry.state?.fileId !== "string") return null;
	if (typeof entry.state.filePath !== "string") return null;
	if (!isMarkdownFilePath(entry.state.filePath)) return null;
	return entry.state.fileId;
}
