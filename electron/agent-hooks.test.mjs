import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	agentHookScriptSource,
	normalizeAgentHookEvent,
} from "./agent-hooks.mjs";

describe("normalizeAgentHookEvent", () => {
	test("normalizes valid hook events", () => {
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					instanceId: "terminal:1",
					agent: "claude",
					phase: "turn-start",
					hookEventName: "UserPromptSubmit",
					sessionId: "session-1",
					turnId: "turn-1",
					cwd: "/workspace",
					createdAt: 123,
				},
				"secret",
			),
		).toEqual({
			id: "event-1",
			instanceId: "terminal:1",
			agent: "claude",
			phase: "turn-start",
			hookEventName: "UserPromptSubmit",
			sessionId: "session-1",
			turnId: "turn-1",
			cwd: "/workspace",
			createdAt: 123,
		});
	});

	test("rejects malformed events and token mismatches", () => {
		expect(normalizeAgentHookEvent(null, "secret")).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "wrong",
					agent: "claude",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "unknown",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					agent: "codex",
					phase: "unknown",
					createdAt: 123,
				},
				"secret",
			),
		).toBeNull();
	});

	test("rejects instance mismatches when an instance is expected", () => {
		expect(
			normalizeAgentHookEvent(
				{
					id: "event-1",
					token: "secret",
					instanceId: "terminal:1",
					agent: "codex",
					phase: "turn-start",
					createdAt: 123,
				},
				"secret",
				"terminal:2",
			),
		).toBeNull();
	});

	test("fills optional identifiers when the hook input omits them", () => {
		const normalized = normalizeAgentHookEvent(
			{
				token: "secret",
				agent: "codex",
				phase: "turn-stop",
			},
			"secret",
		);

		expect(normalized?.agent).toBe("codex");
		expect(normalized?.phase).toBe("turn-stop");
		expect(normalized?.id).toEqual(expect.any(String));
		expect(normalized?.createdAt).toEqual(expect.any(Number));
		expect(normalized?.sessionId).toBeUndefined();
	});
});

describe("agentHookScriptSource", () => {
	test("sends hook events to the socket and waits for acknowledgement", async () => {
		const source = agentHookScriptSource();
		expect(source).toContain("connect(socketPath)");
		expect(source).toContain("FLASHTYPE_AGENT_HOOK_SOCKET");

		const rootDir = await mkdtemp(path.join(tmpdir(), "flashtype-agent-hook-"));
		const socketPath = testSocketPath(rootDir);
		const received = deferred();
		const ackRelease = deferred();
		const server = net.createServer({ allowHalfOpen: true }, (socket) => {
			let input = "";
			socket.setEncoding("utf8");
			socket.on("data", (chunk) => {
				input += chunk;
			});
			socket.on("end", () => {
				received.resolve(JSON.parse(input));
				void ackRelease.promise.then(() => {
					socket.end(`${JSON.stringify({ ok: true })}\n`);
				});
			});
		});
		try {
			const scriptPath = path.join(rootDir, "hook.mjs");
			await writeFile(scriptPath, source, { mode: 0o700 });
			await listen(server, socketPath);

			let exited = false;
			const runPromise = runHookScript({
				scriptPath,
				args: ["codex", "turn-stop"],
				env: {
					FLASHTYPE_AGENT_HOOK_SOCKET: socketPath,
					FLASHTYPE_AGENT_HOOK_TOKEN: "secret",
					FLASHTYPE_AGENT_HOOK_INSTANCE_ID: "terminal:1",
				},
				stdin: JSON.stringify({
					hook_event_name: "Stop",
					session_id: "session-1",
					turn_id: "turn-1",
					cwd: "/workspace",
				}),
			}).then(() => {
				exited = true;
			});

			const raw = await received.promise;
			expect(
				normalizeAgentHookEvent(raw, "secret", "terminal:1"),
			).toMatchObject({
				instanceId: "terminal:1",
				agent: "codex",
				phase: "turn-stop",
				hookEventName: "Stop",
				sessionId: "session-1",
				turnId: "turn-1",
				cwd: "/workspace",
			});
			await delay(50);
			expect(exited).toBe(false);
			ackRelease.resolve();
			await runPromise;
			expect(exited).toBe(true);
		} finally {
			server.close();
			await rm(rootDir, { recursive: true, force: true });
		}
	});

	test("exits successfully when socket delivery fails", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "flashtype-agent-hook-"));
		try {
			const scriptPath = path.join(rootDir, "hook.mjs");
			await writeFile(scriptPath, agentHookScriptSource(), { mode: 0o700 });

			await runHookScript({
				scriptPath,
				args: ["claude", "turn-start"],
				env: {
					FLASHTYPE_AGENT_HOOK_SOCKET: testSocketPath(rootDir),
					FLASHTYPE_AGENT_HOOK_TOKEN: "secret",
					FLASHTYPE_AGENT_HOOK_INSTANCE_ID: "terminal:1",
				},
				stdin: JSON.stringify({
					hook_event_name: "UserPromptSubmit",
				}),
			});
		} finally {
			await rm(rootDir, { recursive: true, force: true });
		}
	});
});

function testSocketPath(rootDir) {
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\flashtype-agent-hook-test-${crypto.randomUUID()}`;
	}
	return path.join(rootDir, "hook.sock");
}

function listen(server, socketPath) {
	return new Promise((resolve, reject) => {
		const handleError = (error) => {
			server.off("listening", handleListening);
			reject(error);
		};
		const handleListening = () => {
			server.off("error", handleError);
			resolve();
		};
		server.once("error", handleError);
		server.once("listening", handleListening);
		server.listen(socketPath);
	});
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function runHookScript({ scriptPath, args, env, stdin }) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath, ...args], {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
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
		child.on("close", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`hook script exited with code ${String(code)} signal ${String(signal)}\n${stdout}${stderr}`,
				),
			);
		});
		child.stdin.end(stdin);
	});
}
