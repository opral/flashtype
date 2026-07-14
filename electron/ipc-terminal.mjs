import { ipcMain } from "electron";
import pty from "node-pty";
import {
	buildTerminalEnv,
	resolveShell,
	resolveShellArgs,
} from "./terminal-shell.mjs";
import {
	createTerminalPathWrapper,
	disposeTerminalPathWrapper,
	prependPathEntry,
} from "./terminal-path-wrapper.mjs";
import {
	createAgentHookEnvironment,
	disposeAgentHookEnvironment,
} from "./agent-hooks.mjs";
import { checkAgentVersionPreflight } from "./agent-version-preflight.mjs";
import { getPreferredAgent } from "./agent-status.mjs";
import { refreshAgentExecutablePaths } from "./agent-executable-paths.mjs";
import { generateCheckpointName } from "./checkpoint-name.mjs";

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

		let pathWrapper = null;
		let terminal;
		try {
			pathWrapper = await createTerminalPathWrapper(payload?.pathWrapper, {
				cwd,
				pathPrefix: env.PATH ?? process.env.PATH,
				shell,
			});
			if (pathWrapper) {
				env.PATH = prependPathEntry(
					pathWrapper.directory,
					env.PATH ?? process.env.PATH,
				);
			}
			const terminalEnv = buildTerminalEnv(process.env, process.platform, env);
			refreshAgentExecutablePathsSoon({
				cwd,
				env: terminalEnv,
				shell,
				shellArgs,
			});
			const agentVersionError = await checkAgentVersionPreflight({
				cwd,
				env: terminalEnv,
				pathWrapper: payload?.pathWrapper,
				shell,
				shellArgs,
			});
			if (agentVersionError) {
				disposeAgentHookEnvironment(id);
				if (pathWrapper) {
					await disposeTerminalPathWrapper(pathWrapper);
				}
				return agentVersionError;
			}
			terminal = pty.spawn(shell, shellArgs, {
				name: "xterm-256color",
				cwd,
				cols,
				rows,
				env: terminalEnv,
			});
		} catch (error) {
			disposeAgentHookEnvironment(id);
			if (pathWrapper) {
				await disposeTerminalPathWrapper(pathWrapper);
			}
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
			pathWrapper,
			terminal,
		});

		return {
			status: "created",
			id,
			...(pathWrapper
				? { pathWrapperExecutablePath: pathWrapper.executablePath }
				: {}),
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

	ipcMain.handle(
		"terminal:refreshAgentExecutablePaths",
		async (_event, payload) => {
			const shell = resolveShell(payload?.shell);
			const shellArgs = resolveShellArgs(shell);
			const terminalEnv = buildTerminalEnv(
				process.env,
				process.platform,
				normalizeExtraEnv(payload?.env),
			);
			return await refreshAgentExecutablePaths({
				cwd: payload?.cwd,
				env: terminalEnv,
				shell,
				shellArgs,
			});
		},
	);

	ipcMain.handle("terminal:getPreferredAgent", async (_event, payload) => {
		const shell = resolveShell(payload?.shell);
		const shellArgs = resolveShellArgs(shell);
		const terminalEnv = buildTerminalEnv(
			process.env,
			process.platform,
			normalizeExtraEnv(payload?.env),
		);
		return await getPreferredAgent({
			cwd: payload?.cwd,
			env: terminalEnv,
			shell,
			shellArgs,
		});
	});

	ipcMain.handle("terminal:generateCheckpointName", async (_event, payload) => {
		const shell = resolveShell(payload?.shell);
		const shellArgs = resolveShellArgs(shell);
		const terminalEnv = buildTerminalEnv(
			process.env,
			process.platform,
			normalizeExtraEnv(payload?.env),
		);
		return await generateCheckpointName({
			cwd: payload?.cwd,
			diffContext: payload?.diffContext,
			env: terminalEnv,
			shell,
			shellArgs,
		});
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
	void disposeTerminalPathWrapper(handle.pathWrapper).catch((error) => {
		console.warn("[terminal] failed to clean up PATH wrapper", error);
	});
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

function refreshAgentExecutablePathsSoon(args) {
	void refreshAgentExecutablePaths(args).catch((error) => {
		console.warn("[terminal] failed to resolve agent executable paths", error);
	});
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
