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
	data: Uint8Array;
};

export type ExternalFileWrite = {
	fileId: string;
	path: string;
	beforeData: Uint8Array;
	afterData: Uint8Array;
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
}: {
	onExternalWrites: (writes: ExternalFileWrite[]) => void;
}) {
	const lix = useLix();
	const lastSnapshotsRef = useRef(new Map<string, ReviewableFileSnapshot>());
	const hasInitialSnapshotRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		const observeEvents = lix.observe(REVIEWABLE_FILE_OBSERVE_SQL);

		const processRows = (rows: unknown) => {
			const rowObjects = normalizeQueryRows(rows);
			const reviewableRows = rowObjects
				.map(readReviewableFileSnapshot)
				.filter((row): row is ReviewableFileSnapshot => row !== null);
			const nextSnapshots = new Map<string, ReviewableFileSnapshot>();
			const externalWrites: ExternalFileWrite[] = [];

			for (const row of reviewableRows) {
				nextSnapshots.set(row.id, row);
				if (!hasInitialSnapshotRef.current) continue;

				const previous = lastSnapshotsRef.current.get(row.id);
				if (!previous || previous.hash === row.hash) continue;

				if (consumeRecentFlashtypeFileWrite(row.id, row.hash)) {
					continue;
				}
				externalWrites.push({
					fileId: row.id,
					path: row.path,
					beforeData: previous.data,
					afterData: row.data,
				});
			}

			lastSnapshotsRef.current = nextSnapshots;
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
	}, [lix, onExternalWrites]);

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
	return {
		id,
		path,
		hash: hashFileData(data),
		data: cloneBytes(decodeFileDataToBytes(data)),
	};
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}
