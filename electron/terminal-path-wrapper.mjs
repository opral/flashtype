import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const WRAPPER_NAMES = new Set(["claude-flashtype", "codex-flashtype"]);

export async function createTerminalPathWrapper(rawWrapper, options = {}) {
	const wrapper = normalizeTerminalPathWrapper(rawWrapper);
	if (!wrapper) {
		return null;
	}
	const directory = await mkdtemp(
		path.join(options.tmpdir ?? tmpdir(), "flashtype-terminal-"),
	);
	await chmod(directory, 0o700);
	const executablePath = path.join(directory, wrapper.executableName);
	try {
		await writeFile(
			executablePath,
			terminalPathWrapperScriptSource({
				command: wrapper.command,
				cwd: options.cwd,
				pathPrefix: options.pathPrefix,
				shell: options.shell,
			}),
			{ mode: 0o700 },
		);
		await chmod(executablePath, 0o700);
		return { directory, executablePath };
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

export async function disposeTerminalPathWrapper(wrapper) {
	if (!wrapper?.directory) {
		return;
	}
	await rm(wrapper.directory, { recursive: true, force: true });
}

export function prependPathEntry(entry, currentPath) {
	if (!entry) {
		return currentPath ?? "";
	}
	return [entry, currentPath].filter(Boolean).join(path.delimiter);
}

export function terminalPathWrapperScriptSource(args) {
	const shell = normalizeShellPath(args?.shell);
	const command = normalizeWrapperCommand(args?.command);
	const cwd = normalizeWorkingDirectory(args?.cwd);
	const pathPrefix = normalizePathPrefix(args?.pathPrefix);
	const pathSetup = pathPrefix
		? `PATH=${shellSingleQuote(pathPrefix)}:"$PATH"\nexport PATH\n`
		: "";
	const cwdSetup = cwd ? `cd ${shellSingleQuote(cwd)}\n` : "";
	return `#!${shell}\n${pathSetup}${cwdSetup}${command}\n`;
}

function normalizeTerminalPathWrapper(value) {
	if (!value || typeof value !== "object") {
		return null;
	}
	const executableName = value.executableName;
	const command = value.command;
	if (
		typeof executableName !== "string" ||
		!WRAPPER_NAMES.has(executableName) ||
		typeof command !== "string" ||
		command.trim().length === 0
	) {
		return null;
	}
	return { executableName, command };
}

function normalizeShellPath(shell) {
	if (
		typeof shell === "string" &&
		shell.startsWith("/") &&
		!shell.includes("\n") &&
		!shell.includes("\0")
	) {
		return shell;
	}
	return "/bin/sh";
}

function normalizePathPrefix(value) {
	return typeof value === "string" && !value.includes("\0") ? value : "";
}

function normalizeWorkingDirectory(value) {
	return typeof value === "string" &&
		path.isAbsolute(value) &&
		!value.includes("\0")
		? value
		: "";
}

function shellSingleQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeWrapperCommand(command) {
	if (typeof command !== "string" || command.trim().length === 0) {
		throw new Error("Terminal PATH wrapper command must be a non-empty string");
	}
	if (command.includes("\0")) {
		throw new Error("Terminal PATH wrapper command cannot contain NUL bytes");
	}
	return command;
}
