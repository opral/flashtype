import { app, ipcMain } from "electron";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const HOOK_ROOT_DIR = "agent-hooks";
const HOOK_SCRIPT_NAME = "flashtype-agent-hook.mjs";
const EVENT_CHANNEL = "agentHooks:turnEvent";
const EVENT_COMPLETE_CHANNEL = "agentHooks:completeTurnEvent";
const HOOK_SOCKET_TIMEOUT_MS = 9_000;
const RENDERER_ACK_TIMEOUT_MS = 8_000;

let bridge = null;
let registered = false;
let socketRootDir = null;
const endpoints = new Map();
const pendingDeliveries = new Map();

export function registerAgentHookIpc() {
	if (registered) {
		return;
	}
	registered = true;
	ipcMain.handle(EVENT_COMPLETE_CHANNEL, (event, payload) => {
		const deliveryId = readNonEmptyString(payload?.deliveryId);
		if (!deliveryId) {
			return { status: "ignored" };
		}
		const pending = pendingDeliveries.get(deliveryId);
		if (!pending || pending.webContentsId !== event.sender.id) {
			return { status: "ignored" };
		}
		clearTimeout(pending.timeout);
		pendingDeliveries.delete(deliveryId);
		pending.resolve({
			status: payload?.status === "error" ? "error" : "ok",
		});
		return { status: "acknowledged" };
	});
}

export function disposeAgentHookIpc() {
	for (const endpoint of endpoints.values()) {
		disposeAgentHookEndpoint(endpoint);
	}
	endpoints.clear();
	for (const [deliveryId, pending] of pendingDeliveries.entries()) {
		clearTimeout(pending.timeout);
		pendingDeliveries.delete(deliveryId);
		pending.resolve({ status: "disposed" });
	}
	cleanupSocketRootDir();
}

export async function createAgentHookEnvironment(args) {
	const instanceId = readNonEmptyString(args?.instanceId);
	const webContents = args?.webContents;
	if (!instanceId) {
		throw new Error("Agent hook instance id is required");
	}
	if (!webContents || typeof webContents.send !== "function") {
		throw new Error("Agent hook webContents owner is required");
	}
	const bridgeState = ensureAgentHookBridge();
	disposeAgentHookEnvironment(instanceId);
	const endpoint = await createAgentHookEndpoint({
		instanceId,
		webContents,
	});
	endpoints.set(instanceId, endpoint);
	return {
		FLASHTYPE_AGENT_HOOK_NODE: process.execPath,
		FLASHTYPE_AGENT_HOOK_SCRIPT: bridgeState.scriptPath,
		FLASHTYPE_AGENT_HOOK_SOCKET: endpoint.socketPath,
		FLASHTYPE_AGENT_HOOK_TOKEN: endpoint.token,
		FLASHTYPE_AGENT_HOOK_INSTANCE_ID: instanceId,
	};
}

export function disposeAgentHookEnvironment(instanceId) {
	const endpoint = endpoints.get(instanceId);
	if (!endpoint) {
		return;
	}
	endpoints.delete(instanceId);
	disposeAgentHookEndpoint(endpoint);
}

export function normalizeAgentHookEvent(
	value,
	expectedToken,
	expectedInstanceId,
) {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value;
	if (record.token !== expectedToken) {
		return null;
	}
	const instanceId = readNonEmptyString(record.instanceId);
	if (expectedInstanceId !== undefined && instanceId !== expectedInstanceId) {
		return null;
	}
	const agent = readEnum(record.agent, ["claude", "codex"]);
	const phase = readEnum(record.phase, ["turn-start", "turn-stop"]);
	if (!agent || !phase) {
		return null;
	}
	const hookInput = parseHookStdin(record.stdinRaw);
	return {
		id: readNonEmptyString(record.id) ?? crypto.randomUUID(),
		instanceId,
		agent,
		phase,
		hookEventName:
			readNonEmptyString(record.hookEventName) ??
			readNonEmptyString(hookInput.hook_event_name),
		sessionId:
			readNonEmptyString(record.sessionId) ??
			readNonEmptyString(hookInput.session_id),
		turnId:
			readNonEmptyString(record.turnId) ??
			readNonEmptyString(hookInput.turn_id),
		cwd: readNonEmptyString(record.cwd) ?? readNonEmptyString(hookInput.cwd),
		createdAt:
			typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
				? record.createdAt
				: Date.now(),
	};
}

function ensureAgentHookBridge() {
	if (bridge) {
		return bridge;
	}
	const rootDir = path.join(app.getPath("userData"), HOOK_ROOT_DIR);
	const scriptPath = path.join(rootDir, HOOK_SCRIPT_NAME);
	mkdirSync(rootDir, { recursive: true });
	writeFileSync(scriptPath, agentHookScriptSource(), { mode: 0o700 });
	bridge = { rootDir, scriptPath };
	return bridge;
}

async function createAgentHookEndpoint({ instanceId, webContents }) {
	const endpointId = crypto.randomUUID();
	const socketPath = agentHookSocketPath(endpointId);
	const token = crypto.randomUUID();
	let endpoint;
	const server = net.createServer({ allowHalfOpen: true }, (socket) => {
		if (!endpoint) {
			socket.destroy();
			return;
		}
		handleAgentHookConnection(endpoint, socket);
	});
	endpoint = {
		closed: false,
		connections: new Set(),
		instanceId,
		server,
		socketPath,
		token,
		webContents,
	};
	if (process.platform !== "win32") {
		rmSync(socketPath, { force: true });
	}
	try {
		await listen(server, socketPath);
	} catch (error) {
		disposeAgentHookEndpoint(endpoint);
		throw error;
	}
	server.unref();
	return endpoint;
}

function listen(server, socketPath) {
	return new Promise((resolve, reject) => {
		const handleError = (error) => {
			server.off("listening", handleListening);
			reject(error);
		};
		const handleListening = () => {
			server.off("error", handleError);
			resolve();
		};
		server.once("error", handleError);
		server.once("listening", handleListening);
		server.listen(socketPath);
	});
}

function disposeAgentHookEndpoint(endpoint) {
	if (endpoint.closed) {
		return;
	}
	endpoint.closed = true;
	for (const socket of endpoint.connections) {
		socket.destroy();
	}
	endpoint.connections.clear();
	try {
		endpoint.server.close(() => {
			cleanupSocketFile(endpoint.socketPath);
		});
	} catch {
		cleanupSocketFile(endpoint.socketPath);
	}
}

function handleAgentHookConnection(endpoint, socket) {
	endpoint.connections.add(socket);
	let input = "";
	let settled = false;

	const finish = (response) => {
		if (settled) {
			return;
		}
		settled = true;
		socket.end(`${JSON.stringify(response)}\n`);
	};

	socket.setEncoding("utf8");
	socket.setTimeout(HOOK_SOCKET_TIMEOUT_MS, () => {
		finish({ ok: false, error: "timeout" });
	});
	socket.on("data", (chunk) => {
		input += chunk;
	});
	socket.on("end", () => {
		if (settled) {
			return;
		}
		void processAgentHookMessage(endpoint, input)
			.then((response) => {
				finish(response);
			})
			.catch((error) => {
				console.warn("[agent-hooks] failed to process hook event", error);
				finish({ ok: false, error: "processing_failed" });
			});
	});
	socket.on("error", () => {
		// The hook process is best-effort from Electron's perspective.
	});
	socket.on("close", () => {
		endpoint.connections.delete(socket);
	});
}

async function processAgentHookMessage(endpoint, input) {
	let raw;
	try {
		raw = JSON.parse(input);
	} catch {
		return { ok: false, error: "invalid_json" };
	}
	const event = normalizeAgentHookEvent(
		raw,
		endpoint.token,
		endpoint.instanceId,
	);
	if (!event) {
		return { ok: false, error: "invalid_event" };
	}
	const delivery = await deliverTurnEvent(endpoint, event);
	return {
		ok: delivery.status !== "timeout" && delivery.status !== "disposed",
		status: delivery.status,
	};
}

function deliverTurnEvent(endpoint, event) {
	if (endpoint.webContents.isDestroyed?.()) {
		return Promise.resolve({ status: "destroyed" });
	}
	return new Promise((resolve) => {
		const deliveryId = crypto.randomUUID();
		const timeout = setTimeout(() => {
			pendingDeliveries.delete(deliveryId);
			resolve({ status: "timeout" });
		}, RENDERER_ACK_TIMEOUT_MS);
		pendingDeliveries.set(deliveryId, {
			resolve,
			timeout,
			webContentsId: endpoint.webContents.id,
		});
		try {
			endpoint.webContents.send(EVENT_CHANNEL, { deliveryId, event });
		} catch (error) {
			clearTimeout(timeout);
			pendingDeliveries.delete(deliveryId);
			console.warn("[agent-hooks] failed to send hook event", error);
			resolve({ status: "send_failed" });
		}
	});
}

function agentHookSocketPath(endpointId) {
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\flashtype-agent-hook-${endpointId}`;
	}
	return path.join(ensureSocketRootDir(), `${endpointId}.sock`);
}

function ensureSocketRootDir() {
	if (socketRootDir) {
		return socketRootDir;
	}
	socketRootDir = path.join("/tmp", `flashtype-agent-hooks-${process.pid}`);
	mkdirSync(socketRootDir, { recursive: true, mode: 0o700 });
	return socketRootDir;
}

function cleanupSocketFile(socketPath) {
	if (process.platform === "win32") {
		return;
	}
	try {
		rmSync(socketPath, { force: true });
	} catch {
		// Best effort cleanup for a process-local socket path.
	}
}

function cleanupSocketRootDir() {
	if (!socketRootDir || process.platform === "win32") {
		socketRootDir = null;
		return;
	}
	try {
		rmSync(socketRootDir, { recursive: true, force: true });
	} catch {
		// Best effort cleanup for process-local sockets.
	}
	socketRootDir = null;
}

function readNonEmptyString(value) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readEnum(value, allowed) {
	return typeof value === "string" && allowed.includes(value) ? value : null;
}

function parseHookStdin(value) {
	if (typeof value !== "string" || value.length === 0) {
		return {};
	}
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function agentHookScriptSource() {
	return String.raw`import { readFileSync } from "node:fs";
import { connect } from "node:net";

const [agent, phase] = process.argv.slice(2);
const socketPath = process.env.FLASHTYPE_AGENT_HOOK_SOCKET;
const token = process.env.FLASHTYPE_AGENT_HOOK_TOKEN;
const instanceId = process.env.FLASHTYPE_AGENT_HOOK_INSTANCE_ID;
const SOCKET_ACK_TIMEOUT_MS = 9000;

if (!socketPath || !token || !instanceId || !agent || !phase) {
	process.exit(0);
}

const payload = {
	instanceId,
	token,
	agent,
	phase,
	stdinRaw: readFileSync(0, "utf8"),
	createdAt: Date.now(),
};

try {
	await sendHookEvent(payload);
} catch {
	// Hook delivery must not prevent the agent command from continuing.
}

function sendHookEvent(payload) {
	return new Promise((resolve, reject) => {
		const socket = connect(socketPath);
		let response = "";
		let settled = false;
		const finish = (error) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			if (error) {
				reject(error);
				return;
			}
			resolve();
		};

		socket.setEncoding("utf8");
		socket.setTimeout(SOCKET_ACK_TIMEOUT_MS, () => {
			finish(new Error("Timed out waiting for hook acknowledgement"));
		});
		socket.on("connect", () => {
			socket.end(JSON.stringify(payload));
		});
		socket.on("data", (chunk) => {
			response += chunk;
		});
		socket.on("end", () => {
			if (response.length === 0) {
				finish(new Error("Hook acknowledgement was empty"));
				return;
			}
			try {
				JSON.parse(response);
			} catch {
				finish(new Error("Hook acknowledgement was invalid JSON"));
				return;
			}
			finish();
		});
		socket.on("error", finish);
		socket.on("close", () => {
			finish(new Error("Hook socket closed before acknowledgement"));
		});
	});
}

`;
}
