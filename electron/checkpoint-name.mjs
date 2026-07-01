import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { refreshAgentExecutablePaths } from "./agent-executable-paths.mjs";

const CHECKPOINT_NAME_TIMEOUT_MS = 45_000;
const MAX_AGENT_OUTPUT_LENGTH = 64 * 1024;
const MAX_DIFF_CONTEXT_LENGTH = 12 * 1024;
const CHECKPOINT_NAME_INSTRUCTIONS = [
	"Name this checkpoint by summarizing the diff below.",
	"Write a concise checkpoint title in 2 to 5 words.",
	'Prefer direct titles like "Update onboarding copy" or "Add new ICP".',
	"Output only the title.",
].join("\n");

export async function generateCheckpointName(args) {
	const cwd = normalizeCwd(args?.cwd);
	const prompt = buildCheckpointNamePrompt(args?.diffContext);
	let paths;
	try {
		paths = await refreshAgentExecutablePaths({
			cwd,
			env: args?.env,
			shell: args?.shell,
			shellArgs: args?.shellArgs,
			timeoutMs: args?.pathResolutionTimeoutMs,
		});
	} catch (error) {
		console.warn("[checkpoint-name] failed to resolve agent paths", error);
		paths = { claude: null, codex: null };
	}

	for (const agent of ["codex", "claude"]) {
		const executablePath = paths[agent];
		if (!executablePath) {
			continue;
		}
		try {
			const name = await generateCheckpointNameWithAgent({
				agent,
				cwd,
				env: args?.env,
				executablePath,
				prompt,
				timeoutMs: args?.timeoutMs,
			});
			if (name) {
				return { name, source: agent };
			}
		} catch (error) {
			console.warn(
				`[checkpoint-name] failed to generate checkpoint name with ${agent}`,
				error,
			);
		}
	}

	return { name: formatLocalTimestamp(), source: "timestamp" };
}

export function buildCheckpointNamePrompt(diffContext) {
	return [
		CHECKPOINT_NAME_INSTRUCTIONS,
		"",
		"Diff context:",
		normalizeDiffContext(diffContext),
	].join("\n");
}

export function formatLocalTimestamp(date = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return [
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
	].join(" ");
}

export function normalizeCheckpointNameOutput(output) {
	const lines = String(output ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	for (const rawLine of lines) {
		const name = rawLine
			.replace(/^```(?:text)?/iu, "")
			.replace(/```$/u, "")
			.replace(/^(?:checkpoint\s+name|name)\s*:\s*/iu, "")
			.replace(/[\u0000-\u001f\u007f]/gu, " ")
			.replace(/[\\/]/gu, "-")
			.replace(/\s+/gu, " ")
			.trim()
			.replace(/^["'`]+|["'`]+$/gu, "")
			.trim();
		if (name.length > 0) {
			return name.slice(0, 80);
		}
	}
	return null;
}

async function generateCheckpointNameWithAgent(args) {
	if (args.agent === "codex") {
		return await generateCheckpointNameWithCodex(args);
	}
	return await generateCheckpointNameWithClaude(args);
}

async function generateCheckpointNameWithCodex(args) {
	const tmpRoot = await mkdtemp(
		path.join(tmpdir(), "flashtype-checkpoint-name-"),
	);
	const outputPath = path.join(tmpRoot, "last-message.txt");
	try {
		const result = await runAgentCommand({
			cwd: args.cwd,
			env: args.env,
			executablePath: args.executablePath,
			args: [
				"exec",
				"--skip-git-repo-check",
				"--ephemeral",
				"--color",
				"never",
				"-s",
				"read-only",
				"-C",
				args.cwd,
				"-o",
				outputPath,
				args.prompt,
			],
			timeoutMs: args.timeoutMs,
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`Codex checkpoint naming exited with ${result.exitCode}: ${result.stderr || result.stdout}`,
			);
		}
		const output = await readFile(outputPath, "utf8").catch(
			() => result.stdout,
		);
		return normalizeCheckpointNameOutput(output);
	} finally {
		await rm(tmpRoot, { recursive: true, force: true });
	}
}

async function generateCheckpointNameWithClaude(args) {
	const result = await runAgentCommand({
		cwd: args.cwd,
		env: args.env,
		executablePath: args.executablePath,
		args: [
			"--print",
			"--output-format",
			"text",
			"--no-session-persistence",
			"--permission-mode",
			"dontAsk",
			args.prompt,
		],
		timeoutMs: args.timeoutMs,
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Claude checkpoint naming exited with ${result.exitCode}: ${result.stderr || result.stdout}`,
		);
	}
	return normalizeCheckpointNameOutput(result.stdout);
}

function runAgentCommand(args) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(args.executablePath, args.args, {
				cwd: args.cwd,
				env: args.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			reject(error);
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;
		let timeout;
		const finish = (result) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			resolve({
				...result,
				stderr: stderr.trim(),
				stdout: stdout.trim(),
			});
		};
		timeout = setTimeout(() => {
			child.kill();
			finish({ exitCode: null, signal: "timeout", timedOut: true });
		}, args.timeoutMs ?? CHECKPOINT_NAME_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout = appendBoundedOutput(stdout, chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr = appendBoundedOutput(stderr, chunk);
		});
		child.on("error", (error) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			reject(error);
		});
		child.on("exit", (exitCode, signal) => {
			finish({
				exitCode: exitCode ?? null,
				signal: signal ?? null,
				timedOut: false,
			});
		});
	});
}

function normalizeCwd(cwd) {
	return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : process.cwd();
}

function normalizeDiffContext(value) {
	const text =
		typeof value === "string" && value.trim().length > 0
			? value
			: "No diff details were available.";
	const normalized = text
		.replace(/\r\n?/gu, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
		.trim();
	if (normalized.length <= MAX_DIFF_CONTEXT_LENGTH) {
		return normalized;
	}
	return `${normalized.slice(0, MAX_DIFF_CONTEXT_LENGTH).trimEnd()}\n[diff context truncated]`;
}

function appendBoundedOutput(current, next) {
	const output = current + next;
	if (output.length <= MAX_AGENT_OUTPUT_LENGTH) {
		return output;
	}
	return output.slice(output.length - MAX_AGENT_OUTPUT_LENGTH);
}
