import { ipcMain } from "electron";
import pty from "node-pty";
import {
	buildTerminalEnv,
	resolveShell,
	resolveShellArgs,
} from "./terminal-shell.mjs";
import {
	createAgentHookEnvironment,
	disposeAgentHookEnvironment,
} from "./agent-hooks.mjs";

const terminals = new Map();
const ownerHooks = new Set();
let registered = false;

export function registerTerminalIpc() {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("terminal:create", async (event, payload) => {
		const id = `terminal:${crypto.randomUUID()}`;
		const shell = resolveShell(payload?.shell);
		const shellArgs = resolveShellArgs(shell);
		const cwd = payload?.cwd;
		const cols = clampInteger(payload?.cols, 80, 20, 500);
		const rows = clampInteger(payload?.rows, 24, 5, 200);
		const agentHookEnv = await createAgentHookEnvironmentSafely(
			id,
			event.sender,
		);
		const env = {
			...normalizeExtraEnv(payload?.env),
			...agentHookEnv,
		};

		let terminal;
		try {
			terminal = pty.spawn(shell, shellArgs, {
				name: "xterm-256color",
				cwd,
				cols,
				rows,
				env: buildTerminalEnv(process.env, process.platform, env),
			});
		} catch (error) {
			disposeAgentHookEnvironment(id);
			throw error;
		}

		const ownerId = event.sender.id;
		ensureOwnerCleanupHook(event.sender);

		terminal.onData((data) => {
			if (event.sender.isDestroyed()) {
				return;
			}
			event.sender.send("terminal:data", { id, data });
		});
		terminal.onExit(({ exitCode, signal }) => {
			if (!event.sender.isDestroyed()) {
				event.sender.send("terminal:exit", {
					id,
					exitCode: exitCode ?? null,
					signal: signal ?? null,
				});
			}
			closeTerminalHandle(id, { kill: false });
		});

		terminals.set(id, {
			ownerId,
			terminal,
		});

		return {
			id,
		};
	});

	ipcMain.handle("terminal:write", (event, payload) => {
		const terminal = getOwnedTerminal(event.sender.id, payload?.id);
		terminal.write(String(payload?.data ?? ""));
	});

	ipcMain.handle("terminal:resize", (event, payload) => {
		const terminal = getOwnedTerminal(event.sender.id, payload?.id);
		const cols = clampInteger(payload?.cols, 80, 20, 500);
		const rows = clampInteger(payload?.rows, 24, 5, 200);
		terminal.resize(cols, rows);
	});

	ipcMain.handle("terminal:kill", (event, payload) => {
		const id = String(payload?.id ?? "");
		const handle = terminals.get(id);
		if (!handle || handle.ownerId !== event.sender.id) {
			return;
		}
		closeTerminalHandle(id, { handle, kill: true });
	});
}

export function disposeTerminalIpc() {
	for (const [id, handle] of terminals.entries()) {
		closeTerminalHandle(id, { handle, kill: true });
	}
}

function ensureOwnerCleanupHook(sender) {
	const ownerId = sender.id;
	if (ownerHooks.has(ownerId)) {
		return;
	}
	ownerHooks.add(ownerId);
	sender.once("destroyed", () => {
		ownerHooks.delete(ownerId);
		for (const [id, handle] of terminals.entries()) {
			if (handle.ownerId !== ownerId) {
				continue;
			}
			closeTerminalHandle(id, { handle, kill: true });
		}
	});
}

function closeTerminalHandle(id, options = {}) {
	const handle = options.handle ?? terminals.get(id);
	if (!handle) {
		disposeAgentHookEnvironment(id);
		return;
	}
	if (options.kill) {
		try {
			handle.terminal.kill();
		} catch {
			// The process may already have exited.
		}
	}
	disposeAgentHookEnvironment(id);
	terminals.delete(id);
}

function getOwnedTerminal(ownerId, rawId) {
	const id = String(rawId ?? "");
	const handle = terminals.get(id);
	if (!handle || handle.ownerId !== ownerId) {
		throw new Error(`Unknown terminal id: ${id}`);
	}
	return handle.terminal;
}

function clampInteger(value, fallback, min, max) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return fallback;
	}
	return Math.max(min, Math.min(max, Math.floor(numeric)));
}

async function createAgentHookEnvironmentSafely(instanceId, webContents) {
	try {
		return await createAgentHookEnvironment({ instanceId, webContents });
	} catch (error) {
		console.warn("[terminal] failed to prepare agent hook environment", error);
		return {};
	}
}

function normalizeExtraEnv(extraEnv) {
	if (!extraEnv || typeof extraEnv !== "object") {
		return {};
	}
	return Object.fromEntries(
		Object.entries(extraEnv).filter(([key, value]) => {
			return (
				typeof key === "string" && key.length > 0 && typeof value === "string"
			);
		}),
	);
}
