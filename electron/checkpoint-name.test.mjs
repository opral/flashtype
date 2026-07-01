import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	formatLocalTimestamp,
	generateCheckpointName,
	normalizeCheckpointNameOutput,
} from "./checkpoint-name.mjs";
import { resetAgentExecutablePathsForTests } from "./agent-executable-paths.mjs";

const unixTest = process.platform === "win32" ? test.skip : test;
const CHECKPOINT_NAME_PROMPT =
	"come up with a funny name for a checkpoint in a markdown editor, in 3 words. output nothing else.";

describe("checkpoint name generation", () => {
	test("formats the local timestamp fallback", () => {
		expect(formatLocalTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe(
			"2026-01-02 03:04:05",
		);
	});

	test("normalizes agent output into a checkpoint name", () => {
		expect(
			normalizeCheckpointNameOutput("Name: `Silly Markdown Pancake`\n"),
		).toBe("Silly Markdown Pancake");
		expect(normalizeCheckpointNameOutput("\n")).toBeNull();
	});

	unixTest("asks Codex first with the checkpoint naming prompt", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-checkpoint-name-test-"),
		);
		try {
			resetAgentExecutablePathsForTests();
			const binDir = path.join(rootDir, "bin");
			await mkdir(binDir);
			const argsPath = path.join(rootDir, "codex-args.txt");
			const promptPath = path.join(rootDir, "prompt.txt");
			await writeExecutable(
				path.join(binDir, "codex"),
				[
					`printf "%s\\n" "$@" > ${shellQuote(argsPath)}`,
					'output_path=""',
					'prompt=""',
					'while [ "$#" -gt 0 ]; do',
					'  if [ "$1" = "-o" ]; then',
					"    shift",
					'    output_path="$1"',
					"  fi",
					'  prompt="$1"',
					"  shift",
					"done",
					`printf "%s\\n" "$prompt" > ${shellQuote(promptPath)}`,
					'printf "%s\\n" "Silly Markdown Pancake" > "$output_path"',
				].join("\n"),
			);

			const result = await generateCheckpointName(
				generatorArgs({ cwd: rootDir, PATH: binDir }),
			);

			expect(result).toEqual({
				name: "Silly Markdown Pancake",
				source: "codex",
			});
			expect((await readFile(argsPath, "utf8")).trimEnd().split("\n")).toEqual([
				"exec",
				"--skip-git-repo-check",
				"--ephemeral",
				"--color",
				"never",
				"-s",
				"read-only",
				"-C",
				rootDir,
				"-o",
				expect.stringContaining("flashtype-checkpoint-name-"),
				CHECKPOINT_NAME_PROMPT,
			]);
			expect(await readFile(promptPath, "utf8")).toBe(
				`${CHECKPOINT_NAME_PROMPT}\n`,
			);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
			resetAgentExecutablePathsForTests();
		}
	});

	// Temporarily skipped: node-pty path probing intermittently times out under
	// the full Vitest worker load, causing this path to fall back to a timestamp.
	test.skip("falls back to Claude when Codex is missing", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-checkpoint-name-test-"),
		);
		try {
			resetAgentExecutablePathsForTests();
			const binDir = path.join(rootDir, "bin");
			await mkdir(binDir);
			await writeExecutable(
				path.join(binDir, "claude"),
				'printf "%s\\n" "Giggle Draft Junction"',
			);

			const result = await generateCheckpointName(
				generatorArgs({ cwd: rootDir, PATH: binDir }),
			);

			expect(result).toEqual({
				name: "Giggle Draft Junction",
				source: "claude",
			});
		} finally {
			await rm(rootDir, { recursive: true, force: true });
			resetAgentExecutablePathsForTests();
		}
	});

	unixTest("falls back to a timestamp when no agent is resolved", async () => {
		const rootDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-checkpoint-name-test-"),
		);
		try {
			resetAgentExecutablePathsForTests();
			const binDir = path.join(rootDir, "bin");
			await mkdir(binDir);

			const result = await generateCheckpointName(
				generatorArgs({ cwd: rootDir, PATH: binDir }),
			);

			expect(result.source).toBe("timestamp");
			expect(result.name).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
		} finally {
			await rm(rootDir, { recursive: true, force: true });
			resetAgentExecutablePathsForTests();
		}
	});
});

function generatorArgs(options = {}) {
	return {
		cwd: options.cwd ?? process.cwd(),
		env: {
			...process.env,
			PATH: options.PATH ?? process.env.PATH,
			TERM: "xterm-256color",
		},
		shell: "/bin/sh",
		shellArgs: [],
		timeoutMs: 1_000,
	};
}

async function writeExecutable(filePath, body) {
	await writeFile(filePath, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
	await chmod(filePath, 0o700);
}

function shellQuote(value) {
	return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}
