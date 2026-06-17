import { ipcMain } from "electron";
import pty from "node-pty";
import {
	buildTerminalEnv,
	resolveShell,
	resolveShellArgs,
} from "./terminal-shell.mjs";

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

		const terminal = pty.spawn(shell, shellArgs, {
			name: "xterm-256color",
			cwd,
			cols,
			rows,
			env: buildTerminalEnv(),
		});

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
			terminals.delete(id);
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
		try {
			handle.terminal.kill();
		} finally {
			terminals.delete(id);
		}
	});
}

export function disposeTerminalIpc() {
	for (const [id, handle] of terminals.entries()) {
		try {
			handle.terminal.kill();
		} finally {
			terminals.delete(id);
		}
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
			try {
				handle.terminal.kill();
			} finally {
				terminals.delete(id);
			}
		}
	});
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
