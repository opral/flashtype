import {
	chmod,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	getCachedAgentExecutablePaths,
	refreshAgentExecutablePaths,
	resetAgentExecutablePathsForTests,
} from "./agent-executable-paths.mjs";

const unixTest = process.platform === "win32" ? test.skip : test;

describe("agent executable path resolution", () => {
	unixTest("resolves Claude and Codex to direct paths from PATH", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-agent-path-test-"),
		);
		try {
			resetAgentExecutablePathsForTests();
			const binDir = path.join(rootDir, "bin");
			await mkdir(binDir);
			await writeExecutable(path.join(binDir, "claude"), "exit 0");
			await writeExecutable(path.join(binDir, "codex"), "exit 0");

			const paths = await refreshAgentExecutablePaths(
				resolverArgs({
					cwd: rootDir,
					PATH: "bin",
				}),
			);

			expect(paths).toEqual({
				claude: await realpath(path.join(binDir, "claude")),
				codex: await realpath(path.join(binDir, "codex")),
			});
			expect(getCachedAgentExecutablePaths()).toEqual(paths);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
			resetAgentExecutablePathsForTests();
		}
	});

	unixTest(
		"resolves paths through a shell that rejects long pasted commands",
		async () => {
			const rootDir = await mkdtemp(
				path.join(tmpdir(), "flashtype-agent-path-test-"),
			);
			try {
				resetAgentExecutablePathsForTests();
				const binDir = path.join(rootDir, "bin");
				const shellPath = path.join(rootDir, "short-command-shell");
				await mkdir(binDir);
				await writeExecutable(path.join(binDir, "claude"), "exit 0");
				await writeExecutable(path.join(binDir, "codex"), "exit 0");
				await writeExecutable(
					shellPath,
					[
						"IFS= read -r command || exit 1",
						'[ "${#command}" -le 80 ] || exit 1',
						'/bin/sh -c "$command"',
					].join("\n"),
				);

				const paths = await refreshAgentExecutablePaths(
					resolverArgs({
						cwd: rootDir,
						PATH: binDir,
						shell: shellPath,
					}),
				);

				expect(paths).toEqual({
					claude: await realpath(path.join(binDir, "claude")),
					codex: await realpath(path.join(binDir, "codex")),
				});
			} finally {
				await rm(rootDir, { recursive: true, force: true });
				resetAgentExecutablePathsForTests();
			}
		},
	);

	unixTest("updates cached paths when agents are missing", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-agent-path-test-"),
		);
		try {
			resetAgentExecutablePathsForTests();
			const binDir = path.join(rootDir, "bin");
			const emptyDir = path.join(rootDir, "empty");
			await mkdir(binDir);
			await mkdir(emptyDir);
			await writeExecutable(path.join(binDir, "claude"), "exit 0");
			await writeExecutable(path.join(binDir, "codex"), "exit 0");
			await writeFile(path.join(emptyDir, ".keep"), "");

			await refreshAgentExecutablePaths(resolverArgs({ PATH: binDir }));
			const missingPaths = await refreshAgentExecutablePaths(
				resolverArgs({ PATH: emptyDir }),
			);

			expect(missingPaths).toEqual({
				claude: null,
				codex: null,
			});
			expect(getCachedAgentExecutablePaths()).toEqual(missingPaths);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
			resetAgentExecutablePathsForTests();
		}
	});

	unixTest(
		"keeps cached paths when the shell probe does not complete",
		async () => {
			const rootDir = await mkdtemp(
				path.join(tmpdir(), "flashtype-agent-path-test-"),
			);
			try {
				resetAgentExecutablePathsForTests();
				const binDir = path.join(rootDir, "bin");
				const shellPath = path.join(rootDir, "hanging-shell");
				await mkdir(binDir);
				await writeExecutable(path.join(binDir, "claude"), "exit 0");
				await writeExecutable(path.join(binDir, "codex"), "exit 0");
				await writeExecutable(
					shellPath,
					"while IFS= read -r _line; do :; done",
				);

				const cached = await refreshAgentExecutablePaths(
					resolverArgs({ PATH: binDir }),
				);
				const afterFailedProbe = await refreshAgentExecutablePaths({
					...resolverArgs({ PATH: "" }),
					shell: shellPath,
					timeoutMs: 25,
				});

				expect(afterFailedProbe).toEqual(cached);
				expect(getCachedAgentExecutablePaths()).toEqual(cached);
			} finally {
				await rm(rootDir, { recursive: true, force: true });
				resetAgentExecutablePathsForTests();
			}
		},
	);
});

function resolverArgs(options = {}) {
	return {
		cwd: options.cwd ?? process.cwd(),
		env: {
			...process.env,
			PATH: options.PATH ?? process.env.PATH,
			TERM: "xterm-256color",
		},
		shell: options.shell ?? "/bin/sh",
		shellArgs: [],
		timeoutMs: options.timeoutMs,
	};
}

async function writeExecutable(filePath, body) {
	await writeFile(filePath, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
	await chmod(filePath, 0o700);
}
