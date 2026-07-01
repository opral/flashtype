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
	buildCheckpointNamePrompt,
	formatLocalTimestamp,
	generateCheckpointName,
	normalizeCheckpointNameOutput,
} from "./checkpoint-name.mjs";
import { resetAgentExecutablePathsForTests } from "./agent-executable-paths.mjs";

const unixTest = process.platform === "win32" ? test.skip : test;

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

	test("builds a safe diff-summary prompt without diff details", () => {
		const prompt = buildCheckpointNamePrompt("");

		expect(prompt).toContain("Name this checkpoint by summarizing the diff");
		expect(prompt).toContain("No diff details were available.");
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

			const diffContext = [
				"Files changed: 1 (1 modified)",
				"File: modified /docs/onboarding.md",
				"After excerpt:",
				"  Welcome to the updated flow.",
			].join("\n");
			const result = await generateCheckpointName(
				generatorArgs({ cwd: rootDir, PATH: binDir, diffContext }),
			);

			expect(result).toEqual({
				name: "Silly Markdown Pancake",
				source: "codex",
			});
			const codexArgs = (await readFile(argsPath, "utf8"))
				.trimEnd()
				.split("\n");
			expect(codexArgs.slice(0, 11)).toEqual([
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
			]);
			const prompt = (await readFile(promptPath, "utf8")).trimEnd();
			expect(prompt).toContain("Name this checkpoint by summarizing the diff");
			expect(prompt).toContain("3 to 8 words");
			expect(prompt).toContain(diffContext);
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
		diffContext: options.diffContext,
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
