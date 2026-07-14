import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	createTerminalPathWrapper,
	disposeTerminalPathWrapper,
	prependPathEntry,
	terminalPathWrapperScriptSource,
} from "./terminal-path-wrapper.mjs";

describe("terminal PATH wrappers", () => {
	test("creates a private executable with the requested agent wrapper name", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-terminal-wrapper-test-"),
		);
		try {
			const wrapper = await createTerminalPathWrapper(
				{
					executableName: "codex-flashtype",
					command: "printf wrapped",
				},
				{ shell: "/bin/sh", tmpdir: rootDir },
			);

			expect(wrapper).toBeTruthy();
			expect(path.basename(wrapper.executablePath)).toBe("codex-flashtype");
			expect(path.dirname(wrapper.executablePath)).toBe(wrapper.directory);

			const directoryMode = (await stat(wrapper.directory)).mode & 0o777;
			const executableMode = (await stat(wrapper.executablePath)).mode & 0o777;
			expect(directoryMode).toBe(0o700);
			expect(executableMode).toBe(0o700);
			await access(wrapper.executablePath, constants.X_OK);

			expect(await readFile(wrapper.executablePath, "utf8")).toBe(
				"#!/bin/sh\nprintf wrapped\n",
			);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	test("runs from a prepended PATH entry", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-terminal-wrapper-test-"),
		);
		try {
			const wrapper = await createTerminalPathWrapper(
				{
					executableName: "claude-flashtype",
					command: "printf claude-wrapper",
				},
				{ shell: "/bin/sh", tmpdir: rootDir },
			);
			const result = await runCommand("claude-flashtype", {
				env: {
					...process.env,
					PATH: prependPathEntry(wrapper.directory, process.env.PATH),
				},
			});

			expect(result.stdout).toBe("claude-wrapper");
			expect(result.stderr).toBe("");
			expect(result.exitCode).toBe(0);

			await disposeTerminalPathWrapper(wrapper);
			await expect(stat(wrapper.directory)).rejects.toThrow();
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	test("writes the command directly into the wrapper script body", () => {
		expect(
			terminalPathWrapperScriptSource({
				shell: "/bin/zsh",
				command: "codex --dangerously-bypass-hook-trust -c 'hooks.Stop=[]'",
			}),
		).toBe(
			"#!/bin/zsh\ncodex --dangerously-bypass-hook-trust -c 'hooks.Stop=[]'\n",
		);
	});

	test("preserves the host PATH ahead of login-shell changes", () => {
		expect(
			terminalPathWrapperScriptSource({
				shell: "/bin/sh",
				command: "codex --version",
				pathPrefix: "/tmp/fake bin:/usr/bin",
			}),
		).toContain(`PATH='/tmp/fake bin:/usr/bin':"$PATH"`);
	});
});

function runCommand(command, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [], {
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("exit", (exitCode) => {
			resolve({ exitCode, stdout, stderr });
		});
	});
}
