import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { refreshAgentExecutablePaths } from "./agent-executable-paths.mjs";

const CHECKPOINT_NAME_TIMEOUT_MS = 45_000;
const MAX_AGENT_OUTPUT_LENGTH = 64 * 1024;
const CHECKPOINT_NAME_PROMPT =
	"come up with a funny name for a checkpoint in a markdown editor, in 3 words. output nothing else.";

export async function generateCheckpointName(args) {
	const cwd = normalizeCwd(args?.cwd);
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
	const tmpRoot = await mkdtemp(path.join(tmpdir(), "flashtype-checkpoint-name-"));
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
				CHECKPOINT_NAME_PROMPT,
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
			CHECKPOINT_NAME_PROMPT,
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

function appendBoundedOutput(current, next) {
	const output = current + next;
	if (output.length <= MAX_AGENT_OUTPUT_LENGTH) {
		return output;
	}
	return output.slice(output.length - MAX_AGENT_OUTPUT_LENGTH);
}
