import { ipcMain } from "electron";
import { Value } from "@lix-js/sdk";
import {
	closeAllLixSessions,
	closeLix,
	ensureLixOpen,
	exportCurrentLixImage,
	resetLixRepository,
} from "./lix.mjs";
import { createOwnedHandleStore } from "./ipc-owned-handles.mjs";

const observeHandles = createOwnedHandleStore("observe");
const observeTraceMeta = createOwnedHandleStore("observe trace");
const transactionHandles = createOwnedHandleStore("transaction");
let registered = false;
let getWindowForEvent = null;
let registerOptions = {};
const LIX_VALUE_ENVELOPE_KEY = "__lixValue";
const LIX_TRACE_SLOW_MS = Number.parseInt(
	process.env.FLASHTYPE_TRACE_LIX_SLOW_MS ?? "25",
	10,
);
const LIX_TRACE_ENABLED = process.env.FLASHTYPE_TRACE_LIX_IPC === "1";

export function registerLixIpc(resolveWindowForEvent, options = {}) {
	if (registered) {
		return;
	}
	registered = true;
	getWindowForEvent = resolveWindowForEvent;
	registerOptions = options;

	ipcMain.handle("lix:open", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return { sessionId: lix.sessionId() };
	});

	ipcMain.handle("lix:workspaceDir", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return lix.workspaceDir();
	});

	ipcMain.handle("lix:storageDir", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return lix.storageDir();
	});

	ipcMain.handle("lix:execute", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const sql = String(payload?.sql ?? "");
		const params = normalizeParams(payload?.params);
		const options = normalizeExecuteOptions(payload?.options);
		const started = performance.now();
		try {
			const result = await lix.execute(sql, params, options);
			const serialized = serializeExecuteResult(result, "lix.execute");
			logSlowOperation("execute", started, {
				sqlHash: hashString(sql),
				sql: summarizeSql(sql),
				paramShapes: params.map((param) => sqlParamShape(param)),
				rowCount: serialized.rows.length,
				columnCount: serialized.columns.length,
			});
			return serialized;
		} catch (error) {
			logOperationError("execute", started, {
				sqlHash: hashString(sql),
				sql: summarizeSql(sql),
				paramShapes: params.map((param) => sqlParamShape(param)),
				error: formatError(error),
			});
			throw error;
		}
	});

	ipcMain.handle("lix:executeTransaction", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const statements = Array.isArray(payload?.statements)
			? payload.statements.map((statement) => ({
					sql: String(statement?.sql ?? ""),
					params: normalizeParams(statement?.params),
				}))
			: [];
		const started = performance.now();
		try {
			const result = await lix.executeTransaction(statements);
			const serialized = serializeExecuteResult(
				result,
				"lix.executeTransaction",
			);
			logSlowOperation("executeTransaction", started, {
				statementCount: statements.length,
				statements: statements.slice(0, 5).map((statement) => ({
					sqlHash: hashString(statement.sql),
					sql: summarizeSql(statement.sql),
					paramShapes: statement.params.map((param) => sqlParamShape(param)),
				})),
				rowCount: serialized.rows.length,
				columnCount: serialized.columns.length,
			});
			return serialized;
		} catch (error) {
			logOperationError("executeTransaction", started, {
				statementCount: statements.length,
				statements: statements.slice(0, 5).map((statement) => ({
					sqlHash: hashString(statement.sql),
					sql: summarizeSql(statement.sql),
					paramShapes: statement.params.map((param) => sqlParamShape(param)),
				})),
				error: formatError(error),
			});
			throw error;
		}
	});

	ipcMain.handle("lix:transaction:begin", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		const transaction = await lix.beginTransaction();
		const transactionId = createId("transaction");
		transactionHandles.set(
			transactionId,
			getOwnerIdForEvent(event),
			transaction,
		);
		return { transactionId };
	});

	ipcMain.handle("lix:transaction:execute", async (event, payload) => {
		const transaction = transactionHandles.get(
			String(payload?.transactionId ?? ""),
			getOwnerIdForEvent(event),
		);
		const sql = String(payload?.sql ?? "");
		const params = normalizeParams(payload?.params);
		const options = normalizeExecuteOptions(payload?.options);
		const started = performance.now();
		try {
			const result = await transaction.execute(sql, params, options);
			const serialized = serializeExecuteResult(result, "transaction.execute");
			logSlowOperation("transaction:execute", started, {
				transactionId: String(payload?.transactionId ?? ""),
				sqlHash: hashString(sql),
				sql: summarizeSql(sql),
				paramShapes: params.map((param) => sqlParamShape(param)),
				rowCount: serialized.rows.length,
				columnCount: serialized.columns.length,
			});
			return serialized;
		} catch (error) {
			logOperationError("transaction:execute", started, {
				transactionId: String(payload?.transactionId ?? ""),
				sqlHash: hashString(sql),
				sql: summarizeSql(sql),
				paramShapes: params.map((param) => sqlParamShape(param)),
				error: formatError(error),
			});
			throw error;
		}
	});

	ipcMain.handle("lix:transaction:commit", async (event, payload) => {
		const transactionId = String(payload?.transactionId ?? "");
		const transaction = transactionHandles.delete(
			transactionId,
			getOwnerIdForEvent(event),
		);
		if (!transaction) {
			throw new Error("transaction handle does not exist or is closed");
		}
		await transaction.commit();
	});

	ipcMain.handle("lix:transaction:rollback", async (event, payload) => {
		const transactionId = String(payload?.transactionId ?? "");
		const transaction = transactionHandles.delete(
			transactionId,
			getOwnerIdForEvent(event),
		);
		if (!transaction) {
			throw new Error("transaction handle does not exist or is closed");
		}
		await transaction.rollback();
	});

	ipcMain.handle("lix:observe:start", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const sql = String(payload?.sql ?? "");
		const params = normalizeParams(payload?.params);
		const observeEvents = lix.observe(sql, params);
		const observeId = createId("observe");
		logTrace("observe:start", {
			observeId,
			sqlHash: hashString(sql),
			sql: summarizeSql(sql),
			paramShapes: params.map((param) => sqlParamShape(param)),
		});
		const ownerId = getOwnerIdForEvent(event);
		observeHandles.set(observeId, ownerId, observeEvents);
		observeTraceMeta.set(observeId, ownerId, {
			sqlHash: hashString(sql),
			sql: summarizeSql(sql),
			paramShapes: params.map((param) => sqlParamShape(param)),
		});
		return observeId;
	});

	ipcMain.handle("lix:observe:next", async (event, payload) => {
		const observeId = String(payload?.observeId ?? "");
		const ownerId = getOwnerIdForEvent(event);
		const observeEvents = observeHandles.getOptional(observeId, ownerId);
		if (!observeEvents) {
			return undefined;
		}
		const started = performance.now();
		try {
			const event = await observeEvents.next();
			if (!event) {
				logSlowOperation("observe:next", started, {
					observeId,
					...observeTraceMeta.getOptional(observeId, ownerId),
					outcome: "none",
				});
				return undefined;
			}
			const serializedResult = serializeExecuteResult(
				event.result,
				"lix.observe",
			);
			logSlowOperation("observe:next", started, {
				observeId,
				...observeTraceMeta.getOptional(observeId, ownerId),
				outcome: "event",
				sequence: event.sequence,
				mutationSequence: event.mutationSequence,
				rowCount: serializedResult.rows.length,
				columnCount: serializedResult.columns.length,
			});
			return {
				sequence: event.sequence,
				mutationSequence: event.mutationSequence,
				result: serializedResult,
			};
		} catch (error) {
			logOperationError("observe:next", started, {
				observeId,
				...observeTraceMeta.getOptional(observeId, ownerId),
				error: formatError(error),
			});
			throw error;
		}
	});

	ipcMain.handle("lix:observe:close", async (event, payload) => {
		const observeId = String(payload?.observeId ?? "");
		const ownerId = getOwnerIdForEvent(event);
		const observeEvents = observeHandles.delete(observeId, ownerId);
		if (!observeEvents) {
			return;
		}
		observeTraceMeta.delete(observeId, ownerId);
		observeEvents.close();
	});

	ipcMain.handle("lix:activeBranchId", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return await lix.activeBranchId();
	});

	ipcMain.handle("lix:createBranch", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const branch = await lix.createBranch(payload?.options ?? {});
		return branch;
	});

	ipcMain.handle("lix:switchBranch", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const result = await lix.switchBranch({
			branchId: String(payload?.branchId ?? ""),
		});
		return result;
	});

	ipcMain.handle("lix:importFilesystemPaths", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const paths = Array.isArray(payload?.paths) ? payload.paths : [];
		await lix.importFilesystemPaths(paths);
	});

	ipcMain.handle("lix:syncDiskToLix", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		await lix.syncDiskToLix();
	});

	ipcMain.handle("lix:close", async (event, payload) => {
		await closeLixSession(getWindowForIpcEvent(event), {
			expectedSessionId:
				typeof payload?.sessionId === "string" ? payload.sessionId : undefined,
		});
	});

	ipcMain.handle("workspace:resetLixRepository", async (event) => {
		const window = getWindowForIpcEvent(event);
		await closeAllHandles(window.id);
		await resetLixRepository(window);
	});

	ipcMain.handle("workspace:disableTrackChanges", async (event) => {
		if (typeof registerOptions.disableTrackChanges !== "function") {
			throw new Error("workspace.disableTrackChanges is not available");
		}
		const window = getWindowForIpcEvent(event);
		await closeLixSession(window, { ignoreOpenError: true });
		return await registerOptions.disableTrackChanges(window);
	});

	ipcMain.handle("workspace:exportLixFile", async (event) => {
		const window = getWindowForIpcEvent(event);
		await closeAllHandles(window.id);
		return await exportCurrentLixImage(window);
	});
}

async function ensureLixOpenForEvent(event) {
	return await ensureLixOpen(getWindowForIpcEvent(event));
}

export async function disposeLixIpc() {
	await closeAllHandles();
	await closeAllLixSessions({ ignoreOpenError: true });
	registerOptions = {};
}

export async function closeLixSession(window, options = {}) {
	if (!window) {
		return;
	}
	await closeAllHandles(window.id);
	await closeLix(window, options);
}

async function closeAllHandles(ownerId) {
	const observeEntries =
		ownerId === undefined
			? observeHandles.values().map((value) => ({ value }))
			: observeHandles.valuesForOwner(ownerId);
	for (const { value: observeEvents } of observeEntries) {
		observeEvents.close();
	}
	if (ownerId === undefined) {
		observeHandles.clear();
		observeTraceMeta.clear();
	} else {
		observeHandles.clearOwner(ownerId);
		observeTraceMeta.clearOwner(ownerId);
	}

	const openTransactions =
		ownerId === undefined
			? transactionHandles.values()
			: transactionHandles.valuesForOwner(ownerId).map((entry) => entry.value);
	if (ownerId === undefined) {
		transactionHandles.clear();
	} else {
		transactionHandles.clearOwner(ownerId);
	}
	for (const transaction of openTransactions) {
		try {
			await transaction.rollback();
		} catch {
			// ignore rollback errors while closing handles
		}
	}
}

function getWindowForIpcEvent(event) {
	if (!getWindowForEvent) {
		throw new Error("lix IPC is not registered with a window resolver");
	}
	const window = getWindowForEvent(event);
	if (!window || window.isDestroyed()) {
		throw new Error("No window is available for this lix request.");
	}
	return window;
}

function getOwnerIdForEvent(event) {
	return getWindowForIpcEvent(event).id;
}

function createId(prefix) {
	return `${prefix}:${crypto.randomUUID()}`;
}

function hashString(value) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function summarizeSql(sql) {
	return String(sql).replace(/\s+/g, " ").trim().slice(0, 220);
}

function sqlParamShape(value) {
	if (value === null) return "null";
	if (value instanceof Uint8Array) return `Uint8Array(${value.byteLength})`;
	if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength})`;
	if (Array.isArray(value)) return `array(${value.length})`;
	return `${typeof value}`;
}

function formatError(error) {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return String(error);
}

function logSlowOperation(operation, startedAt, details) {
	const durationMs = performance.now() - startedAt;
	if (!LIX_TRACE_ENABLED || durationMs < LIX_TRACE_SLOW_MS) {
		return;
	}
	logTrace(operation, {
		durationMs: Number(durationMs.toFixed(2)),
		...details,
	});
}

function logOperationError(operation, startedAt, details) {
	const durationMs = performance.now() - startedAt;
	if (!LIX_TRACE_ENABLED) {
		return;
	}
	logTrace(`${operation}:error`, {
		durationMs: Number(durationMs.toFixed(2)),
		...details,
	});
}

function logTrace(event, payload) {
	if (!LIX_TRACE_ENABLED) {
		return;
	}
	console.log(`[lix-ipc-trace] ${new Date().toISOString()} ${event}`, payload);
}

function normalizeParams(params) {
	if (!Array.isArray(params)) {
		return [];
	}
	return params.map((param, index) => normalizeSqlParam(param, index));
}

function normalizeExecuteOptions(options) {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		return undefined;
	}
	if (typeof options.originKey !== "string") {
		return undefined;
	}
	return { originKey: options.originKey };
}

function normalizeSqlParam(value, index = 0) {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (typeof value === "bigint") {
		const asNumber = Number(value);
		return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
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

	if (isLixValueEnvelope(value)) {
		return normalizeLixValueEnvelope(value, index);
	}

	if (Array.isArray(value) || isPlainObject(value)) {
		return normalizeJsonValue(value, `params[${index}]`);
	}

	throw new TypeError(
		`SQL parameter ${index + 1} must be a primitive, Uint8Array, JSON value, or tagged Lix value envelope`,
	);
}

function normalizeLixValueEnvelope(value, index) {
	const kind = normalizeLixValueKind(value.kind);
	switch (kind) {
		case "null":
			if (value.value !== null) {
				throw new TypeError(
					`SQL parameter ${index + 1} null envelope must contain null`,
				);
			}
			return Value.null();
		case "boolean":
			if (typeof value.value !== "boolean") {
				throw new TypeError(
					`SQL parameter ${index + 1} boolean envelope must contain a boolean`,
				);
			}
			return Value.boolean(value.value);
		case "integer": {
			if (
				typeof value.value !== "number" ||
				!Number.isSafeInteger(value.value)
			) {
				throw new TypeError(
					`SQL parameter ${index + 1} integer envelope must contain a safe integer`,
				);
			}
			return Value.integer(value.value);
		}
		case "real": {
			if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
				throw new TypeError(
					`SQL parameter ${index + 1} real envelope must contain a finite number`,
				);
			}
			return Value.real(value.value);
		}
		case "text":
			if (typeof value.value !== "string") {
				throw new TypeError(
					`SQL parameter ${index + 1} text envelope must contain a string`,
				);
			}
			return Value.text(value.value);
		case "json":
			return Value.json(
				normalizeJsonValue(value.value, `params[${index}].value`),
			);
		case "blob":
			return Value.blob(normalizeBlobValue(value, index));
		default:
			throw new TypeError(
				`SQL parameter ${index + 1} has unsupported Lix value kind '${String(value.kind)}'`,
			);
	}
}

function normalizeLixValueKind(kind) {
	switch (kind) {
		case "null":
		case "Null":
			return "null";
		case "bool":
		case "boolean":
		case "Boolean":
			return "boolean";
		case "int":
		case "integer":
		case "Integer":
			return "integer";
		case "float":
		case "real":
		case "Real":
			return "real";
		case "text":
		case "Text":
			return "text";
		case "json":
		case "Json":
		case "JSON":
			return "json";
		case "blob":
		case "Blob":
			return "blob";
		default:
			return undefined;
	}
}

function normalizeBlobValue(value, index) {
	if (typeof value.base64 === "string") {
		return base64ToBytes(value.base64);
	}
	const raw = value.value;
	if (raw instanceof Uint8Array) {
		return raw;
	}
	if (raw instanceof ArrayBuffer) {
		return new Uint8Array(raw);
	}
	if (ArrayBuffer.isView(raw)) {
		return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
	}
	if (typeof raw === "string") {
		return base64ToBytes(raw);
	}
	throw new TypeError(
		`SQL parameter ${index + 1} blob envelope must contain base64 or binary data`,
	);
}

function normalizeJsonValue(value, path, seen = new WeakSet()) {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`${path} must contain only finite JSON numbers`);
		}
		return value;
	}
	if (Array.isArray(value)) {
		enterJsonContainer(value, path, seen);
		try {
			return value.map((entry, index) =>
				normalizeJsonValue(entry, `${path}[${index}]`, seen),
			);
		} finally {
			seen.delete(value);
		}
	}
	if (isPlainObject(value)) {
		enterJsonContainer(value, path, seen);
		try {
			return Object.fromEntries(
				Object.entries(value).map(([key, entry]) => [
					key,
					normalizeJsonValue(entry, `${path}.${key}`, seen),
				]),
			);
		} finally {
			seen.delete(value);
		}
	}
	throw new TypeError(`${path} must be JSON-serializable`);
}

function enterJsonContainer(value, path, seen) {
	if (seen.has(value)) {
		throw new TypeError(`${path} must not contain circular references`);
	}
	seen.add(value);
}

function isLixValueEnvelope(value) {
	return (
		isPlainObject(value) &&
		value[LIX_VALUE_ENVELOPE_KEY] === true &&
		typeof value.kind === "string"
	);
}

function isPlainObject(value) {
	if (!value || typeof value !== "object") return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function base64ToBytes(base64) {
	return new Uint8Array(Buffer.from(base64, "base64"));
}

function serializeQueryResult(result) {
	const rows = Array.isArray(result?.rows)
		? result.rows.map((row) => serializeSqlRow(row, result.columns))
		: [];
	const columns =
		Array.isArray(result?.columns) &&
		result.columns.every((column) => typeof column === "string")
			? result.columns
			: [];
	const rowsAffected =
		typeof result?.rowsAffected === "number" ? result.rowsAffected : 0;
	const notices = Array.isArray(result?.notices) ? result.notices : [];
	return { rows, columns, rowsAffected, notices };
}

function serializeExecuteResult(result, source) {
	const statements = result?.statements;
	if (Array.isArray(result?.columns) && Array.isArray(result?.rows)) {
		return serializeQueryResult(result);
	}
	if (!Array.isArray(statements)) {
		throw new Error(
			`${source} returned invalid execute result (missing statements[])`,
		);
	}
	const primary = statements[statements.length - 1];
	if (!primary || typeof primary !== "object") {
		throw new Error(`${source} returned execute result without statements`);
	}
	return serializeQueryResult(primary);
}

function serializeSqlRow(row, columns) {
	if (Array.isArray(row)) {
		return row.map((value) => serializeSqlValue(value));
	}
	if (row && typeof row === "object") {
		if (
			Array.isArray(columns) &&
			columns.every((column) => typeof column === "string") &&
			typeof row.get === "function"
		) {
			return columns.map((column) => serializeSqlValue(row.get(column)));
		}
		if (
			Array.isArray(columns) &&
			columns.every((column) => typeof column === "string") &&
			typeof row.toObject === "function"
		) {
			const object = row.toObject();
			return columns.map((column) => serializeSqlValue(object[column]));
		}
		if (typeof row.toObject === "function") {
			return Object.values(row.toObject()).map((value) =>
				serializeSqlValue(value),
			);
		}
		return Object.values(row).map((value) => serializeSqlValue(value));
	}
	return [];
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
