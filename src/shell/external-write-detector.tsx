import { useEffect, useRef } from "react";
import { useLix } from "@/lib/lix-react";
import {
	EXTERNAL_WRITE_REVIEWABLE_FILE_EXTENSIONS,
	isExternalWriteReviewableFilePath,
} from "@/extension-runtime/file-handlers";
import {
	consumeRecentFlashtypeFileWrite,
	hashFileData,
} from "@/extension-runtime/external-write-tracking";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";

type ReviewableFileSnapshot = {
	id: string;
	path: string;
	hash: string;
	bytes: Uint8Array;
};

export type ExternalFileWrite = {
	fileId: string;
	path: string;
};

const REVIEWABLE_FILE_EXTENSION_CLAUSE =
	EXTERNAL_WRITE_REVIEWABLE_FILE_EXTENSIONS.map(
		(extension) => `lower(path) LIKE '%.${extension}'`,
	).join("\n\t\tOR ");

const REVIEWABLE_FILE_OBSERVE_SQL = `
	SELECT id, path, data
	FROM lix_file
	WHERE ${REVIEWABLE_FILE_EXTENSION_CLAUSE}
	ORDER BY id
`;

export function ExternalWriteDetector({
	onExternalWrites,
	onReviewableFileFirstObserved,
}: {
	onExternalWrites: (writes: ExternalFileWrite[]) => void;
	/**
	 * Called once the first time each reviewable file is observed (at boot and
	 * for files added later), with the bytes seen at that moment. The shell uses
	 * this to establish a tracked Lix baseline so the file's FIRST external edit
	 * can be reviewed per-change.
	 */
	onReviewableFileFirstObserved?: (fileId: string, bytes: Uint8Array) => void;
}) {
	const lix = useLix();
	const lastHashesRef = useRef(new Map<string, string>());
	const hasInitialSnapshotRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		const observeEvents = lix.observe(REVIEWABLE_FILE_OBSERVE_SQL);

		const processRows = (rows: unknown) => {
			const rowObjects = normalizeQueryRows(rows);
			const reviewableRows = rowObjects
				.map(readReviewableFileSnapshot)
				.filter((row): row is ReviewableFileSnapshot => row !== null);
			const nextHashes = new Map<string, string>();
			const externalWrites: ExternalFileWrite[] = [];

			for (const row of reviewableRows) {
				const firstSeen = !lastHashesRef.current.has(row.id);
				nextHashes.set(row.id, row.hash);
				if (firstSeen) onReviewableFileFirstObserved?.(row.id, row.bytes);
				if (!hasInitialSnapshotRef.current) continue;

				const previousHash = lastHashesRef.current.get(row.id);
				if (!previousHash || previousHash === row.hash) continue;

				if (consumeRecentFlashtypeFileWrite(row.id, row.hash)) {
					continue;
				}
				externalWrites.push({ fileId: row.id, path: row.path });
			}

			lastHashesRef.current = nextHashes;
			if (!hasInitialSnapshotRef.current) {
				hasInitialSnapshotRef.current = true;
				return;
			}
			if (externalWrites.length === 0) return;
			onExternalWrites(externalWrites);
		};

		void (async () => {
			try {
				while (!cancelled) {
					const event = await observeEvents.next();
					if (cancelled || !event) break;
					processRows(event.result);
				}
			} catch (error) {
				if (!cancelled) {
					console.warn("[external-write-detector] observe failed", error);
				}
			}
		})();

		return () => {
			cancelled = true;
			observeEvents.close();
		};
	}, [lix, onExternalWrites, onReviewableFileFirstObserved]);

	return null;
}

function normalizeQueryRows(value: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(value)) {
		return value.flatMap(normalizeQueryRow);
	}
	if (!value || typeof value !== "object") {
		return [];
	}
	const maybeRows = (value as { rows?: unknown }).rows;
	if (Array.isArray(maybeRows)) {
		return maybeRows.flatMap(normalizeQueryRow);
	}
	return [];
}

function normalizeQueryRow(value: unknown): Array<Record<string, unknown>> {
	if (!value || typeof value !== "object") return [];
	if (typeof (value as { toObject?: unknown }).toObject === "function") {
		return [(value as { toObject(): Record<string, unknown> }).toObject()];
	}
	if (typeof (value as { get?: unknown }).get === "function") {
		const get = (value as { get(column: string): unknown }).get.bind(value);
		return [
			{
				id: get("id"),
				path: get("path"),
				data: get("data"),
			},
		];
	}
	return [value as Record<string, unknown>];
}

function readReviewableFileSnapshot(
	row: Record<string, unknown>,
): ReviewableFileSnapshot | null {
	const id = row.id;
	const path = row.path;
	const data = row.data;
	if (typeof id !== "string" || typeof path !== "string") return null;
	if (!isExternalWriteReviewableFilePath(path)) return null;
	const bytes = decodeFileDataToBytes(data);
	return {
		id,
		path,
		hash: hashFileData(bytes),
		bytes,
	};
}
