import { ipcMain } from "electron";
import { closeLix, ensureLixOpen, wipeLixStorage } from "./lix.mjs";

const observeHandles = new Map();
const stateCommitStreamHandles = new Map();
let registered = false;

export function registerLixIpc() {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("lix:open", async () => {
		await ensureLixOpen();
	});

	ipcMain.handle("lix:execute", async (_event, payload) => {
		const lix = await ensureLixOpen();
		const result = await lix.execute(
			String(payload?.sql ?? ""),
			normalizeParams(payload?.params),
			normalizeExecuteOptions(payload?.options),
		);
		return serializeQueryResult(result);
	});

	ipcMain.handle("lix:executeTransaction", async (_event, payload) => {
		const lix = await ensureLixOpen();
		const statements = Array.isArray(payload?.statements)
			? payload.statements.map((statement) => ({
					sql: String(statement?.sql ?? ""),
					params: normalizeParams(statement?.params),
				}))
			: [];
		const result = await lix.executeTransaction(
			statements,
			normalizeExecuteOptions(payload?.options),
		);
		return serializeQueryResult(result);
	});

	ipcMain.handle("lix:observe:start", async (_event, payload) => {
		const lix = await ensureLixOpen();
		const observeEvents = lix.observe({
			sql: String(payload?.query?.sql ?? ""),
			params: normalizeParams(payload?.query?.params),
		});
		const observeId = createId("observe");
		observeHandles.set(observeId, observeEvents);
		return observeId;
	});

	ipcMain.handle("lix:observe:next", async (_event, payload) => {
		const observeEvents = observeHandles.get(String(payload?.observeId ?? ""));
		if (!observeEvents) {
			return undefined;
		}
		const event = await observeEvents.next();
		if (!event) {
			return undefined;
		}
		return {
			sequence: event.sequence,
			stateCommitSequence: event.stateCommitSequence,
			rows: serializeQueryResult(event.rows),
		};
	});

	ipcMain.handle("lix:observe:close", async (_event, payload) => {
		const observeId = String(payload?.observeId ?? "");
		const observeEvents = observeHandles.get(observeId);
		if (!observeEvents) {
			return;
		}
		observeHandles.delete(observeId);
		observeEvents.close();
	});

	ipcMain.handle("lix:stateCommitStream:open", async (_event, payload) => {
		const lix = await ensureLixOpen();
		const stream = lix.stateCommitStream(payload?.filter ?? {});
		const streamId = createId("state-commit-stream");
		stateCommitStreamHandles.set(streamId, stream);
		return streamId;
	});

	ipcMain.handle("lix:stateCommitStream:tryNext", async (_event, payload) => {
		const stream = stateCommitStreamHandles.get(
			String(payload?.streamId ?? ""),
		);
		if (!stream) {
			return undefined;
		}
		return stream.tryNext() ?? undefined;
	});

	ipcMain.handle("lix:stateCommitStream:close", async (_event, payload) => {
		const streamId = String(payload?.streamId ?? "");
		const stream = stateCommitStreamHandles.get(streamId);
		if (!stream) {
			return;
		}
		stateCommitStreamHandles.delete(streamId);
		stream.close();
	});

	ipcMain.handle("lix:createVersion", async (_event, payload) => {
		const lix = await ensureLixOpen();
		return await lix.createVersion(payload?.options ?? {});
	});

	ipcMain.handle("lix:switchVersion", async (_event, payload) => {
		const lix = await ensureLixOpen();
		await lix.switchVersion(String(payload?.versionId ?? ""));
	});

	ipcMain.handle("lix:createCheckpoint", async () => {
		const lix = await ensureLixOpen();
		return await lix.createCheckpoint();
	});

	ipcMain.handle("lix:installPlugin", async (_event, payload) => {
		const lix = await ensureLixOpen();
		await lix.installPlugin({
			archiveBytes: normalizeArchiveBytes(payload?.archiveBytes),
		});
	});

	ipcMain.handle("lix:exportSnapshot", async () => {
		const lix = await ensureLixOpen();
		return await lix.exportSnapshot();
	});

	ipcMain.handle("lix:close", async () => {
		closeAllHandles();
		await closeLix();
	});

	ipcMain.handle("lix:wipe", async () => {
		closeAllHandles();
		await wipeLixStorage();
	});
}

export async function disposeLixIpc() {
	closeAllHandles();
	await closeLix();
}

function closeAllHandles() {
	for (const observeEvents of observeHandles.values()) {
		observeEvents.close();
	}
	observeHandles.clear();

	for (const stream of stateCommitStreamHandles.values()) {
		stream.close();
	}
	stateCommitStreamHandles.clear();
}

function createId(prefix) {
	return `${prefix}:${crypto.randomUUID()}`;
}

function normalizeParams(params) {
	if (!Array.isArray(params)) {
		return [];
	}
	return params;
}

function normalizeExecuteOptions(options) {
	if (!options || typeof options !== "object") {
		return undefined;
	}
	if (!Object.hasOwn(options, "writerKey")) {
		return undefined;
	}
	return {
		writerKey: options.writerKey ?? null,
	};
}

function normalizeArchiveBytes(rawBytes) {
	if (rawBytes instanceof Uint8Array) {
		return rawBytes;
	}
	if (rawBytes instanceof ArrayBuffer) {
		return new Uint8Array(rawBytes);
	}
	if (ArrayBuffer.isView(rawBytes)) {
		return new Uint8Array(
			rawBytes.buffer,
			rawBytes.byteOffset,
			rawBytes.byteLength,
		);
	}
	throw new Error(
		"installPlugin requires archiveBytes as Uint8Array or ArrayBuffer",
	);
}

function serializeQueryResult(result) {
	const rows = Array.isArray(result?.rows)
		? result.rows.map((row) =>
				Array.isArray(row) ? row.map((value) => serializeSqlValue(value)) : [],
			)
		: [];
	const columns =
		Array.isArray(result?.columns) &&
		result.columns.every((column) => typeof column === "string")
			? result.columns
			: [];
	return { rows, columns };
}

function serializeSqlValue(value) {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (typeof value === "bigint") {
		return value.toString();
	}

	if (value instanceof Uint8Array) {
		return value;
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}

	if (Array.isArray(value)) {
		return value.map((entry) => serializeSqlValue(entry));
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	if (typeof value.kind === "function") {
		const kind = value.kind();
		const raw = Object.hasOwn(value, "value") ? value.value : undefined;
		return {
			kind,
			value: serializeSqlValue(raw),
		};
	}

	if (typeof value.kind === "string" && Object.hasOwn(value, "value")) {
		return {
			kind: value.kind,
			value: serializeSqlValue(value.value),
		};
	}

	return value;
}
