import { decodeFileDataToBytes } from "@/lib/decode-file-data";

const RECENT_SELF_WRITE_TTL_MS = 10_000;
const recentSelfWrites = new Map<
	string,
	Array<{ hash: string; timestamp: number }>
>();

export function hashFileData(value: unknown): string {
	const bytes = decodeFileDataToBytes(value);
	let hash = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i += 1) {
		hash ^= bytes[i] ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function markFlashtypeFileWrite(
	fileId: string,
	data: unknown,
	now = Date.now(),
): void {
	const existing = pruneRecentWrites(recentSelfWrites.get(fileId) ?? [], now);
	existing.push({ hash: hashFileData(data), timestamp: now });
	recentSelfWrites.set(fileId, existing);
}

export function consumeRecentFlashtypeFileWrite(
	fileId: string,
	hash: string,
	now = Date.now(),
): boolean {
	const existing = pruneRecentWrites(recentSelfWrites.get(fileId) ?? [], now);
	const index = existing.findIndex((entry) => entry.hash === hash);
	if (index < 0) {
		if (existing.length === 0) {
			recentSelfWrites.delete(fileId);
		} else {
			recentSelfWrites.set(fileId, existing);
		}
		return false;
	}
	existing.splice(index, 1);
	if (existing.length === 0) {
		recentSelfWrites.delete(fileId);
	} else {
		recentSelfWrites.set(fileId, existing);
	}
	return true;
}

function pruneRecentWrites(
	entries: Array<{ hash: string; timestamp: number }>,
	now: number,
): Array<{ hash: string; timestamp: number }> {
	return entries.filter(
		(entry) => now - entry.timestamp <= RECENT_SELF_WRITE_TTL_MS,
	);
}
