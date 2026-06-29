import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	checkAgentVersionPreflight,
	compareSemver,
	parseFirstSemver,
} from "./agent-version-preflight.mjs";

const unixTest = process.platform === "win32" ? test.skip : test;

describe("agent version preflight", () => {
	test("parses versions from agent version output", () => {
		expect(parseFirstSemver("codex-cli 0.134.0")).toBe("0.134.0");
		expect(parseFirstSemver("2.1.78 (Claude Code)")).toBe("2.1.78");
		expect(parseFirstSemver("codex-cli 0.134.0-alpha.1")).toBe(
			"0.134.0-alpha.1",
		);
		expect(parseFirstSemver("no version here")).toBeNull();
	});

	test("compares semantic versions including prereleases", () => {
		expect(compareSemver("0.134.0", "0.134.0")).toBe(0);
		expect(compareSemver("0.134.1", "0.134.0")).toBe(1);
		expect(compareSemver("0.133.0", "0.134.0")).toBe(-1);
		expect(compareSemver("0.134.0-alpha.1", "0.134.0")).toBe(-1);
	});

	unixTest("passes supported Claude and Codex versions from PATH", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-agent-version-test-"),
		);
		try {
			await writeExecutable(
				path.join(rootDir, "claude"),
				'printf "%s\\n" "2.1.78 (Claude Code)"',
			);
			await writeExecutable(
				path.join(rootDir, "codex"),
				'printf "%s\\n" "codex-cli 0.134.0"',
			);

			await expect(
				checkAgentVersionPreflight(
					preflightArgs("claude-flashtype", { PATH: rootDir }),
				),
			).resolves.toBeNull();
			await expect(
				checkAgentVersionPreflight(
					preflightArgs("codex-flashtype", { PATH: rootDir }),
				),
			).resolves.toBeNull();
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	unixTest("fails unsupported agent versions", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-agent-version-test-"),
		);
		try {
			await writeExecutable(
				path.join(rootDir, "claude"),
				'printf "%s\\n" "2.1.77 (Claude Code)"',
			);
			await writeExecutable(
				path.join(rootDir, "codex"),
				'printf "%s\\n" "codex-cli 0.134.0-alpha.1"',
			);

			await expect(
				checkAgentVersionPreflight(
					preflightArgs("claude-flashtype", { PATH: rootDir }),
				),
			).resolves.toMatchObject({
				status: "agentVersionError",
				agent: "claude",
				requiredVersion: "2.1.78",
				detectedVersion: "2.1.77",
				reason: "unsupported",
			});
			await expect(
				checkAgentVersionPreflight(
					preflightArgs("codex-flashtype", { PATH: rootDir }),
				),
			).resolves.toMatchObject({
				status: "agentVersionError",
				agent: "codex",
				requiredVersion: "0.134.0",
				detectedVersion: "0.134.0-alpha.1",
				reason: "unsupported",
			});
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	unixTest(
		"reports missing, failed, unparseable, and timed-out checks",
		async () => {
			const rootDir = await mkdtemp(
				path.join(tmpdir(), "flashtype-agent-version-test-"),
			);
			const missingDir = path.join(rootDir, "missing");
			try {
				await writeFile(path.join(rootDir, "empty"), "");
				await writeExecutable(
					path.join(rootDir, "codex"),
					'printf "%s\\n" "codex dev build"',
				);

				await expect(
					checkAgentVersionPreflight(
						preflightArgs("claude-flashtype", { PATH: missingDir }),
					),
				).resolves.toMatchObject({
					status: "agentVersionError",
					reason: "missing",
				});
				await expect(
					checkAgentVersionPreflight(
						preflightArgs("codex-flashtype", { PATH: rootDir }),
					),
				).resolves.toMatchObject({
					status: "agentVersionError",
					reason: "unparseable",
				});

				await writeExecutable(
					path.join(rootDir, "codex"),
					'printf "%s\\n" "version failed" >&2\nexit 2',
				);
				await expect(
					checkAgentVersionPreflight(
						preflightArgs("codex-flashtype", { PATH: rootDir }),
					),
				).resolves.toMatchObject({
					status: "agentVersionError",
					reason: "failed",
				});

				await writeExecutable(path.join(rootDir, "codex"), "/bin/sleep 10");
				await expect(
					checkAgentVersionPreflight(
						preflightArgs("codex-flashtype", {
							PATH: rootDir,
							timeoutMs: 100,
						}),
					),
				).resolves.toMatchObject({
					status: "agentVersionError",
					reason: "timeout",
				});
			} finally {
				await rm(rootDir, { recursive: true, force: true });
			}
		},
	);
});

function preflightArgs(executableName, options = {}) {
	return {
		cwd: process.cwd(),
		env: {
			...process.env,
			PATH: options.PATH ?? process.env.PATH,
			TERM: "xterm-256color",
		},
		pathWrapper: {
			executableName,
			command: "unused",
		},
		shell: "/bin/sh",
		shellArgs: [],
		timeoutMs: options.timeoutMs,
	};
}

async function writeExecutable(filePath, body) {
	await writeFile(filePath, `#!/bin/sh\n${body}\n`);
	await chmod(filePath, 0o700);
}
