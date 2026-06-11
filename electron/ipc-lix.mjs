import { BrowserWindow, ipcMain } from "electron";
import { closeLix, ensureLixOpen } from "./lix.mjs";

const observeHandles = new Map();
const observeTraceMeta = new Map();
const transactionHandles = new Map();
let registered = false;
const LIX_TRACE_SLOW_MS = Number.parseInt(
	process.env.FLASHTYPE_TRACE_LIX_SLOW_MS ?? "25",
	10,
);
const LIX_TRACE_ENABLED = process.env.FLASHTYPE_TRACE_LIX_IPC === "1";

export function registerLixIpc() {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("lix:open", async (event) => {
		await ensureLixOpenForEvent(event);
	});

	ipcMain.handle("lix:workspaceDir", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return lix.workspaceDir();
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
				writerKey: options?.writerKey ?? null,
				rowCount: serialized.rows.length,
				columnCount: serialized.columns.length,
			});
			return serialized;
		} catch (error) {
			logOperationError("execute", started, {
				sqlHash: hashString(sql),
				sql: summarizeSql(sql),
				paramShapes: params.map((param) => sqlParamShape(param)),
				writerKey: options?.writerKey ?? null,
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
		const options = normalizeExecuteOptions(payload?.options);
		const started = performance.now();
		try {
			const result = await lix.executeTransaction(statements, options);
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
				writerKey: options?.writerKey ?? null,
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
				writerKey: options?.writerKey ?? null,
				error: formatError(error),
			});
			throw error;
		}
	});

	ipcMain.handle("lix:transaction:begin", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const transaction = await lix.beginTransaction(
			normalizeExecuteOptions(payload?.options),
		);
		const transactionId = createId("transaction");
		transactionHandles.set(transactionId, transaction);
		return { transactionId };
	});

	ipcMain.handle("lix:transaction:execute", async (_event, payload) => {
		const transaction = transactionHandles.get(
			String(payload?.transactionId ?? ""),
		);
		if (!transaction) {
			throw new Error("transaction handle does not exist or is closed");
		}
		const sql = String(payload?.sql ?? "");
		const params = normalizeParams(payload?.params);
		const started = performance.now();
		try {
			const result = await transaction.execute(sql, params);
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

	ipcMain.handle("lix:transaction:commit", async (_event, payload) => {
		const transactionId = String(payload?.transactionId ?? "");
		const transaction = transactionHandles.get(transactionId);
		if (!transaction) {
			throw new Error("transaction handle does not exist or is closed");
		}
		transactionHandles.delete(transactionId);
		await transaction.commit();
	});

	ipcMain.handle("lix:transaction:rollback", async (_event, payload) => {
		const transactionId = String(payload?.transactionId ?? "");
		const transaction = transactionHandles.get(transactionId);
		if (!transaction) {
			throw new Error("transaction handle does not exist or is closed");
		}
		transactionHandles.delete(transactionId);
		await transaction.rollback();
	});

	ipcMain.handle("lix:observe:start", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		const sql = String(payload?.query?.sql ?? "");
		const params = normalizeParams(payload?.query?.params);
		const observeEvents = lix.observe({
			sql,
			params,
		});
		const observeId = createId("observe");
		observeHandles.set(observeId, observeEvents);
		observeTraceMeta.set(observeId, {
			sqlHash: hashString(sql),
			sql: summarizeSql(sql),
			paramShapes: params.map((param) => sqlParamShape(param)),
		});
		logTrace("observe:start", {
			observeId,
			sqlHash: hashString(sql),
			sql: summarizeSql(sql),
			paramShapes: params.map((param) => sqlParamShape(param)),
		});
		return observeId;
	});

	ipcMain.handle("lix:observe:next", async (_event, payload) => {
		const observeId = String(payload?.observeId ?? "");
		const observeEvents = observeHandles.get(observeId);
		if (!observeEvents) {
			return undefined;
		}
		const started = performance.now();
		try {
			const event = await observeEvents.next();
			if (!event) {
				logSlowOperation("observe:next", started, {
					observeId,
					...observeTraceMeta.get(observeId),
					outcome: "none",
				});
				return undefined;
			}
			const serializedRows = serializeQueryResult(event.rows);
			logSlowOperation("observe:next", started, {
				observeId,
				...observeTraceMeta.get(observeId),
				outcome: "event",
				sequence: event.sequence,
				rowCount: serializedRows.rows.length,
				columnCount: serializedRows.columns.length,
			});
			return {
				sequence: event.sequence,
				rows: serializedRows,
			};
		} catch (error) {
			logOperationError("observe:next", started, {
				observeId,
				...observeTraceMeta.get(observeId),
				error: formatError(error),
			});
			throw error;
		}
	});

	ipcMain.handle("lix:observe:close", async (_event, payload) => {
		const observeId = String(payload?.observeId ?? "");
		const observeEvents = observeHandles.get(observeId);
		if (!observeEvents) {
			return;
		}
		observeHandles.delete(observeId);
		observeTraceMeta.delete(observeId);
		observeEvents.close();
	});

	ipcMain.handle("lix:activeBranchId", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return await lix.activeBranchId();
	});

	ipcMain.handle("lix:createBranch", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		return await lix.createBranch(payload?.options ?? {});
	});

	ipcMain.handle("lix:switchBranch", async (event, payload) => {
		const lix = await ensureLixOpenForEvent(event);
		return await lix.switchBranch({
			branchId: String(payload?.branchId ?? ""),
		});
	});

	ipcMain.handle("lix:exportSnapshot", async (event) => {
		const lix = await ensureLixOpenForEvent(event);
		return await lix.exportSnapshot();
	});

	ipcMain.handle("lix:close", async () => {
		await closeAllHandles();
		await closeLix();
	});
}

async function ensureLixOpenForEvent(event) {
	return await ensureLixOpen(BrowserWindow.fromWebContents(event.sender));
}

export async function disposeLixIpc() {
	await closeAllHandles();
	await closeLix();
}

async function closeAllHandles() {
	for (const observeEvents of observeHandles.values()) {
		observeEvents.close();
	}
	observeHandles.clear();
	observeTraceMeta.clear();

	const openTransactions = [...transactionHandles.values()];
	transactionHandles.clear();
	for (const transaction of openTransactions) {
		try {
			await transaction.rollback();
		} catch {
			// ignore rollback errors while closing handles
		}
	}
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
	return params.map((param) => normalizeSqlParam(param));
}

function normalizeSqlParam(value) {
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

	if (Array.isArray(value)) {
		return JSON.stringify(value);
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	if (typeof value.kind === "string") {
		const kind = value.kind;
		if (kind === "null" || kind === "Null") {
			return null;
		}
		if (kind === "bool" || kind === "Boolean") {
			return Boolean(value.value);
		}
		if (
			kind === "int" ||
			kind === "Integer" ||
			kind === "float" ||
			kind === "Real"
		) {
			const parsed = Number(value.value);
			return Number.isFinite(parsed) ? parsed : null;
		}
		if (kind === "text" || kind === "Text") {
			return typeof value.value === "string"
				? value.value
				: String(value.value ?? "");
		}
		if (kind === "blob" || kind === "Blob") {
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
			return new Uint8Array();
		}
	}

	// Backward-compatible fallback: plain objects were historically JSON-stringified.
	return JSON.stringify(value);
}

function base64ToBytes(base64) {
	return new Uint8Array(Buffer.from(base64, "base64"));
}

function normalizeExecuteOptions(options) {
	if (!options || typeof options !== "object") {
		return undefined;
	}
	const writerKey = options.writerKey;
	if (writerKey === undefined) {
		return undefined;
	}
	if (writerKey !== null && typeof writerKey !== "string") {
		return undefined;
	}
	return {
		writerKey,
	};
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
