import {
	consumeRecentFlashtypeFileWrite,
	hashFileData,
	markFlashtypeFileWrite,
} from "@/widget-runtime/external-write-tracking";

export function hashMarkdownData(value: unknown): string {
	return hashFileData(value);
}

export function markFlashtypeMarkdownWrite(
	fileId: string,
	markdown: string,
	now = Date.now(),
): void {
	markFlashtypeFileWrite(fileId, markdown, now);
}

export function consumeRecentFlashtypeMarkdownWrite(
	fileId: string,
	hash: string,
	now = Date.now(),
): boolean {
	return consumeRecentFlashtypeFileWrite(fileId, hash, now);
}

export {
	consumeRecentFlashtypeFileWrite,
	hashFileData,
	markFlashtypeFileWrite,
};
