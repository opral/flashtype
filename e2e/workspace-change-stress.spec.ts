import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import seedrandom from "seedrandom";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeFile,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

const stressAppPath = "/stress.md";
const stressFileName = "stress.md";
const operationCount = 100; // TODO: 10_000
const stressSeed = "workspace-change-stress-e2e-v1";
const initialMarkdown = "seed 0000\n";
const lixTracePrefix = "[lix-ipc-trace]";
const maxLixDirectoryBytes = 64 * 1024 * 1024;

test.skip(
	process.platform === "win32",
	"fake agent shell helper is POSIX-only",
);
test.skip(!existsSync("/bin/sh"), "fake agent shell helper requires /bin/sh");
test.setTimeout(7_200_000);

test("stress tests workspace changes through manual edits and fake agent turns", async ({
	browserName: _browserName,
}, testInfo) => {
	const rng = seedrandom(stressSeed);
	const userDataDir = testInfo.outputPath("user-data");
	const workspaceDir = testInfo.outputPath("workspace");
	const helperScriptPath = testInfo.outputPath("fake-agent-turn.mjs");
	const payloadDir = testInfo.outputPath("agent-payloads");
	const stressDiskPath = path.join(workspaceDir, stressFileName);
	let expectedMarkdown = initialMarkdown;
	let electronApp: ElectronApplication | undefined;
	let traceCapture: LixTraceCapture | undefined;
	const profile = createStressProfile(operationCount);

	try {
		await timeProfile(profile, "setup:files", null, async () => {
			await mkdir(workspaceDir, { recursive: true });
			await mkdir(payloadDir, { recursive: true });
			await writeFile(stressDiskPath, expectedMarkdown, "utf8");
			await writeFakeAgentTurnHelper(helperScriptPath);
		});

		electronApp = await timeProfile(
			profile,
			"setup:launch",
			null,
			async () =>
				await launchDevElectronApp(workspaceDir, {
					env: {
						FLASHTYPE_TRACE_LIX_IPC: "1",
						FLASHTYPE_TRACE_LIX_SLOW_MS: "0",
					},
					userDataDir,
				}),
		);
		traceCapture = startLixTraceCapture(electronApp);
		const page = await timeProfile(
			profile,
			"setup:first-window",
			null,
			async () => await electronApp!.firstWindow(),
		);
		registerRendererConsoleLogging(page);

		await timeProfile(profile, "setup:open-file", null, async () => {
			await openStressMarkdown(page);
			await installStressEditorHelpers(page);
		});
		await timeProfile(profile, "setup:initial-settle", null, async () => {
			await expectMarkdownSettled({
				diskPath: stressDiskPath,
				expectedMarkdown,
				page,
			});
		});

		for (let index = 0; index < operationCount; index += 1) {
			const token = nextToken(rng);
			const kind = rng() < 0.5 ? "manual" : "agent";
			const nextMarkdown = markdownForOperation(kind, index, token);

			if (kind === "manual") {
				recordStressOperation(profile, kind);
				expectedMarkdown = nextMarkdown;
				await timeProfile(profile, "manual:edit", index, async () => {
					await applyManualEdit(page, nextMarkdown);
				});
				await timeProfile(profile, "manual:settle", index, async () => {
					await expectMarkdownSettled({
						diskPath: stressDiskPath,
						expectedMarkdown,
						page,
					});
				});
			} else {
				const beforeAgentMarkdown = expectedMarkdown;
				const proposedMarkdown = nextMarkdown;
				const keep = rng() < 0.5;
				recordStressOperation(profile, kind, keep);
				const payloadPath = path.join(
					payloadDir,
					`agent-${index.toString().padStart(4, "0")}.md`,
				);
				await timeProfile(profile, "agent:write-payload", index, async () => {
					await writeFile(payloadPath, proposedMarkdown, "utf8");
				});
				await timeProfile(profile, "agent:terminal-turn", index, async () => {
					await runFakeAgentTurn(page, {
						helperScriptPath,
						payloadPath,
						sessionId: "workspace-change-stress",
						targetPath: stressDiskPath,
						turnId: `turn-${index.toString().padStart(4, "0")}`,
						workspaceDir,
					});
				});
				try {
					await timeProfile(profile, "agent:wait-review", index, async () => {
						await waitForReviewControls(page);
					});
				} catch (error) {
					throw new Error(
						await buildAgentReviewTimeoutMessage({
							beforeAgentMarkdown,
							diskPath: stressDiskPath,
							error,
							index,
							page,
							proposedMarkdown,
						}),
					);
				}
				await timeProfile(profile, "agent:click-review", index, async () => {
					await page
						.getByRole("button", { name: keep ? "Keep" : "Undo" })
						.click();
				});
				await timeProfile(
					profile,
					"agent:wait-review-hidden",
					index,
					async () => {
						await expect(
							page.getByRole("group", {
								name: "External write review actions",
							}),
						).toBeHidden({ timeout: 30_000 });
					},
				);

				expectedMarkdown = keep ? proposedMarkdown : beforeAgentMarkdown;
				await timeProfile(profile, "agent:settle", index, async () => {
					await expectMarkdownSettled({
						diskPath: stressDiskPath,
						expectedMarkdown,
						page,
					});
				});
			}

			if ((index + 1) % progressLogInterval(operationCount) === 0) {
				console.log(
					`[workspace-change-stress] completed ${index + 1}/${operationCount}`,
				);
			}
		}

		await timeProfile(profile, "final:settle", null, async () => {
			await expectMarkdownSettled({
				diskPath: stressDiskPath,
				expectedMarkdown,
				page,
				timeout: 60_000,
			});
		});
		await timeProfile(profile, "final:lix-size", null, async () => {
			const lixStorageDir = await readLixStorageDir(page);
			const lixDirectorySize = await directorySizeBytes(lixStorageDir);
			profile.lixStorage = {
				limitBytes: maxLixDirectoryBytes,
				path: lixStorageDir,
				sizeBytes: lixDirectorySize,
			};
			expect(
				lixDirectorySize,
				`Lix storage directory ${lixStorageDir} should stay below ${formatBytes(
					maxLixDirectoryBytes,
				)}; actual size was ${formatBytes(lixDirectorySize)}`,
			).toBeLessThanOrEqual(maxLixDirectoryBytes);
		});
	} finally {
		await timeProfile(profile, "teardown:close", null, async () => {
			await closeElectronApp(electronApp);
		});
		const profileSummary = summarizeStressProfile(profile);
		console.log(formatStressProfileSummary(profileSummary));
		await testInfo.attach("workspace-change-stress-profile.json", {
			body: JSON.stringify(
				{ operations: profile.operations, summary: profileSummary, profile },
				null,
				2,
			),
			contentType: "application/json",
		});
		const traceLines = traceCapture?.stop() ?? [];
		if (traceLines.length > 0) {
			await testInfo.attach("lix-ipc-trace.log", {
				body: traceLines.join("\n"),
				contentType: "text/plain",
			});
		}
	}
});

type LixTraceCapture = {
	stop: () => string[];
};

type StressProfilePhase =
	| "setup:files"
	| "setup:launch"
	| "setup:first-window"
	| "setup:open-file"
	| "setup:initial-settle"
	| "manual:edit"
	| "manual:settle"
	| "agent:write-payload"
	| "agent:terminal-turn"
	| "agent:wait-review"
	| "agent:click-review"
	| "agent:wait-review-hidden"
	| "agent:settle"
	| "final:settle"
	| "final:lix-size"
	| "teardown:close";

type StressProfileEntry = {
	readonly durationMs: number;
	readonly operationIndex: number | null;
	readonly phase: StressProfilePhase;
};

type StressProfile = {
	readonly entries: StressProfileEntry[];
	lixStorage?: {
		readonly limitBytes: number;
		readonly path: string;
		readonly sizeBytes: number;
	};
	readonly operationCount: number;
	readonly operations: {
		agentKeep: number;
		agentUndo: number;
		manual: number;
	};
	readonly seed: string;
	readonly startedAt: string;
};

type StressProfilePhaseSummary = {
	readonly avgMs: number;
	readonly count: number;
	readonly maxMs: number;
	readonly p50Ms: number;
	readonly p95Ms: number;
	readonly phase: StressProfilePhase;
	readonly totalMs: number;
};

type StressProfileSummary = {
	readonly lixStorage?: StressProfile["lixStorage"];
	readonly operationCount: number;
	readonly operations: StressProfile["operations"];
	readonly phases: StressProfilePhaseSummary[];
	readonly seed: string;
	readonly totalProfiledMs: number;
};

function progressLogInterval(count: number): number {
	return count <= 200 ? 25 : 100;
}

function createStressProfile(count: number): StressProfile {
	return {
		entries: [],
		operationCount: count,
		operations: {
			agentKeep: 0,
			agentUndo: 0,
			manual: 0,
		},
		seed: stressSeed,
		startedAt: new Date().toISOString(),
	};
}

function recordStressOperation(
	profile: StressProfile,
	kind: "agent" | "manual",
	keep?: boolean,
): void {
	if (kind === "manual") {
		profile.operations.manual += 1;
		return;
	}
	if (keep) {
		profile.operations.agentKeep += 1;
	} else {
		profile.operations.agentUndo += 1;
	}
}

async function timeProfile<T>(
	profile: StressProfile,
	phase: StressProfilePhase,
	operationIndex: number | null,
	operation: () => Promise<T>,
): Promise<T> {
	const startedAt = performance.now();
	try {
		return await operation();
	} finally {
		profile.entries.push({
			durationMs: roundMs(performance.now() - startedAt),
			operationIndex,
			phase,
		});
	}
}

function summarizeStressProfile(profile: StressProfile): StressProfileSummary {
	const phases = Array.from(
		new Set(profile.entries.map((entry) => entry.phase)),
	).map((phase) => {
		const durations = profile.entries
			.filter((entry) => entry.phase === phase)
			.map((entry) => entry.durationMs)
			.sort((left, right) => left - right);
		const totalMs = durations.reduce((sum, value) => sum + value, 0);
		return {
			avgMs: roundMs(totalMs / durations.length),
			count: durations.length,
			maxMs: durations.at(-1) ?? 0,
			p50Ms: percentile(durations, 50),
			p95Ms: percentile(durations, 95),
			phase,
			totalMs: roundMs(totalMs),
		};
	});

	phases.sort((left, right) => right.totalMs - left.totalMs);

	return {
		lixStorage: profile.lixStorage,
		operationCount: profile.operationCount,
		operations: profile.operations,
		phases,
		seed: profile.seed,
		totalProfiledMs: roundMs(
			profile.entries.reduce((sum, entry) => sum + entry.durationMs, 0),
		),
	};
}

function formatStressProfileSummary(summary: StressProfileSummary): string {
	const lines = [
		`[workspace-change-stress] profile seed=${summary.seed} operations=${summary.operationCount} manual=${summary.operations.manual} agentKeep=${summary.operations.agentKeep} agentUndo=${summary.operations.agentUndo} totalProfiledMs=${summary.totalProfiledMs}`,
	];
	if (summary.lixStorage) {
		lines.push(
			`[workspace-change-stress] lixStorage path=${summary.lixStorage.path} size=${formatBytes(
				summary.lixStorage.sizeBytes,
			)} limit=${formatBytes(summary.lixStorage.limitBytes)}`,
		);
	}
	lines.push("[workspace-change-stress] slowest phases:");
	for (const phase of summary.phases.slice(0, 10)) {
		lines.push(
			`[workspace-change-stress] ${phase.phase} count=${phase.count} total=${phase.totalMs}ms avg=${phase.avgMs}ms p50=${phase.p50Ms}ms p95=${phase.p95Ms}ms max=${phase.maxMs}ms`,
		);
	}
	return lines.join("\n");
}

function percentile(
	sortedDurations: readonly number[],
	percentileValue: number,
) {
	if (sortedDurations.length === 0) return 0;
	const index = Math.min(
		sortedDurations.length - 1,
		Math.ceil((percentileValue / 100) * sortedDurations.length) - 1,
	);
	return sortedDurations[index] ?? 0;
}

function roundMs(value: number): number {
	return Number(value.toFixed(2));
}

function startLixTraceCapture(
	electronApp: ElectronApplication,
): LixTraceCapture {
	const childProcess = electronApp.process();
	const streams = [childProcess.stdout, childProcess.stderr].filter(
		(stream): stream is NonNullable<typeof stream> => Boolean(stream),
	);
	if (streams.length === 0) {
		return { stop: () => [] };
	}

	const lines: string[] = [];
	const pendingByStream = new Map<(typeof streams)[number], string>();
	const listeners = streams.map((stream) => {
		pendingByStream.set(stream, "");
		const listener = (chunk: Buffer | string) => {
			const pending = pendingByStream.get(stream) ?? "";
			const text = pending + String(chunk);
			const parts = text.split(/\r?\n/);
			pendingByStream.set(stream, parts.pop() ?? "");
			for (const line of parts) {
				if (line.includes(lixTracePrefix)) {
					lines.push(line);
				}
			}
		};
		stream.on("data", listener);
		return { listener, stream };
	});

	return {
		stop() {
			for (const { listener, stream } of listeners) {
				stream.off("data", listener);
				const pending = pendingByStream.get(stream);
				if (pending?.includes(lixTracePrefix)) {
					lines.push(pending);
				}
			}
			pendingByStream.clear();
			return lines;
		},
	};
}

async function openStressMarkdown(page: Page): Promise<void> {
	await ensureFilesViewOpenInLeftPanel(page);
	const file = fileTreeFile(page, stressAppPath);
	await expect(file).toBeVisible();
	await file.click();
	await expect(file).toHaveAttribute("data-item-selected", "true");
	await expect(
		page.locator('[data-testid="tiptap-editor"] .ProseMirror'),
	).toBeVisible();
	await expect(
		page.locator('[data-active="true"][data-view-key="atelier_file"]'),
	).toBeVisible();
}

async function applyManualEdit(page: Page, markdown: string): Promise<void> {
	await selectEditorContents(page);
	await page.keyboard.type(markdown.replace(/\n$/, ""));
}

async function runFakeAgentTurn(
	page: Page,
	args: {
		helperScriptPath: string;
		payloadPath: string;
		sessionId: string;
		targetPath: string;
		turnId: string;
		workspaceDir: string;
	},
): Promise<void> {
	const command = [
		"ELECTRON_RUN_AS_NODE=1",
		'"$FLASHTYPE_AGENT_HOOK_NODE"',
		shellQuote(args.helperScriptPath),
		shellQuote(args.targetPath),
		shellQuote(args.payloadPath),
		shellQuote(args.workspaceDir),
		shellQuote(args.sessionId),
		shellQuote(args.turnId),
	].join(" ");
	const result = await page.evaluate(
		async ({ command, cwd }) => {
			const desktop = window.flashtypeDesktop;
			if (!desktop?.terminal) {
				throw new Error("Desktop terminal API is unavailable.");
			}

			const terminal = await desktop.terminal.create({
				cols: 120,
				cwd,
				rows: 20,
				shell: "/bin/sh",
			});

			return await new Promise<{
				exitCode: number | null;
				output: string;
				signal: number | null;
			}>((resolve, reject) => {
				let output = "";
				let settled = false;
				let cleanupData: (() => void) | undefined;
				let cleanupExit: (() => void) | undefined;
				const timeoutId = window.setTimeout(() => {
					finish(
						() =>
							reject(
								new Error(
									`Timed out waiting for fake agent terminal ${terminal.id}.\n${output}`,
								),
							),
						true,
					);
				}, 30_000);

				const finish = (complete: () => void, kill = false) => {
					if (settled) return;
					settled = true;
					window.clearTimeout(timeoutId);
					cleanupData?.();
					cleanupExit?.();
					if (kill) {
						void desktop.terminal.kill({ id: terminal.id });
					}
					complete();
				};

				cleanupData = desktop.terminal.onData((event) => {
					if (event.id === terminal.id) {
						output += event.data;
					}
				});
				cleanupExit = desktop.terminal.onExit((event) => {
					if (event.id !== terminal.id) return;
					finish(() =>
						resolve({
							exitCode: event.exitCode,
							output,
							signal: event.signal,
						}),
					);
				});

				void desktop.terminal
					.write({ id: terminal.id, data: `${command}; exit $?\r` })
					.catch((error: unknown) => {
						finish(() => reject(error), true);
					});
			});
		},
		{ command, cwd: args.workspaceDir },
	);

	if (
		result.exitCode !== 0 ||
		(result.signal !== null && result.signal !== 0)
	) {
		throw new Error(
			[
				"Fake agent turn failed.",
				`exitCode=${result.exitCode}`,
				`signal=${result.signal}`,
				`output=${JSON.stringify(result.output)}`,
			].join("\n"),
		);
	}
}

async function waitForReviewControls(page: Page): Promise<void> {
	await expect(
		page.getByRole("group", { name: "External write review actions" }),
	).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole("button", { name: "Keep" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
}

async function buildAgentReviewTimeoutMessage(args: {
	beforeAgentMarkdown: string;
	diskPath: string;
	error: unknown;
	index: number;
	page: Page;
	proposedMarkdown: string;
}): Promise<string> {
	const state = await readMarkdownState(args.page, args.diskPath).catch(
		(error: unknown) => ({ stateReadError: String(error) }),
	);
	return [
		"Timed out waiting for fake agent review controls.",
		`operationIndex=${args.index}`,
		`beforeAgentMarkdown=${JSON.stringify(args.beforeAgentMarkdown)}`,
		`proposedMarkdown=${JSON.stringify(args.proposedMarkdown)}`,
		`state=${JSON.stringify(state)}`,
		`cause=${
			args.error instanceof Error ? args.error.message : String(args.error)
		}`,
	].join("\n");
}

async function expectMarkdownSettled(args: {
	diskPath: string;
	expectedMarkdown: string;
	page: Page;
	timeout?: number;
}): Promise<void> {
	await expect
		.poll(async () => await readMarkdownState(args.page, args.diskPath), {
			timeout: args.timeout ?? 30_000,
		})
		.toEqual({
			diskMarkdown: args.expectedMarkdown,
			editorMarkdown: args.expectedMarkdown,
			lixMarkdown: args.expectedMarkdown,
		});
}

async function readMarkdownState(
	page: Page,
	diskPath: string,
): Promise<{
	diskMarkdown: string | null;
	editorMarkdown: string | null;
	lixMarkdown: string | null;
}> {
	const [diskMarkdown, editorMarkdown, lixMarkdown] = await Promise.all([
		readDiskMarkdown(diskPath),
		readEditorMarkdown(page),
		readPersistedMarkdown(page, stressAppPath),
	]);
	return { diskMarkdown, editorMarkdown, lixMarkdown };
}

async function readDiskMarkdown(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

async function directorySizeBytes(directoryPath: string): Promise<number> {
	let directoryStat;
	try {
		directoryStat = await stat(directoryPath);
	} catch (error) {
		if (isNodeErrorCode(error, "ENOENT")) return 0;
		throw error;
	}
	if (!directoryStat.isDirectory()) {
		throw new Error(`${directoryPath} exists but is not a directory`);
	}

	let total = 0;
	const entries = await readdir(directoryPath, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(directoryPath, entry.name);
		if (entry.isDirectory()) {
			total += await directorySizeBytes(entryPath);
		} else if (entry.isFile()) {
			total += (await stat(entryPath)).size;
		}
	}
	return total;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === code
	);
}

function formatBytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

async function readPersistedMarkdown(
	page: Page,
	filePath: string,
): Promise<string | null> {
	return await page.evaluate(async (pathToFind) => {
		const queryResult = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT data FROM lix_file WHERE path = $1",
			params: [pathToFind],
		});
		return decodeMarkdownValue(queryResult?.rows?.[0]?.[0]);

		function decodeMarkdownValue(value: unknown): string | null {
			if (value == null) return null;
			if (
				typeof value === "object" &&
				"value" in value &&
				typeof (value as { kind?: unknown }).kind === "string"
			) {
				return decodeMarkdownValue((value as { value: unknown }).value);
			}
			if (value instanceof Uint8Array) {
				return new TextDecoder().decode(value);
			}
			if (value instanceof ArrayBuffer) {
				return new TextDecoder().decode(new Uint8Array(value));
			}
			if (ArrayBuffer.isView(value)) {
				return new TextDecoder().decode(
					new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
				);
			}
			if (Array.isArray(value)) {
				return new TextDecoder().decode(new Uint8Array(value as number[]));
			}
			if (typeof value === "string") return value;
			return null;
		}
	}, filePath);
}

async function installStressEditorHelpers(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as any).__flashtypeWorkspaceStress = {
			selectAll() {
				const editor = requireEditor();
				editor.focus({ preventScroll: true });
				const selection = window.getSelection();
				if (!selection) {
					throw new Error("Window selection is unavailable.");
				}
				const range = document.createRange();
				range.selectNodeContents(editor);
				selection.removeAllRanges();
				selection.addRange(range);
				editor.dispatchEvent(new Event("selectionchange", { bubbles: true }));
			},
			markdown() {
				const editor = requireEditor();
				const blocks = Array.from(editor.children);
				if (blocks.length === 0) return "";
				return `${blocks
					.map((block) => block.textContent ?? "")
					.join("\n\n")}\n`;
			},
		};

		function requireEditor(): HTMLElement {
			const editor = document.querySelector(
				'[data-testid="tiptap-editor"] .ProseMirror',
			);
			if (!(editor instanceof HTMLElement)) {
				throw new Error("Active ProseMirror editor is unavailable.");
			}
			return editor;
		}
	});
}

async function selectEditorContents(page: Page): Promise<void> {
	await page.evaluate(() => {
		const api = (window as any).__flashtypeWorkspaceStress;
		if (!api) {
			throw new Error("Workspace stress editor helpers are not installed.");
		}
		api.selectAll();
	});
}

async function readEditorMarkdown(page: Page): Promise<string | null> {
	return await page.evaluate(() => {
		const api = (window as any).__flashtypeWorkspaceStress;
		if (!api) return null;
		return api.markdown();
	});
}

async function readLixStorageDir(page: Page): Promise<string> {
	return await page.evaluate(async () => {
		const storageDir = await window.flashtypeDesktop?.lix.storageDir();
		if (!storageDir) {
			throw new Error("Desktop Lix storage directory is unavailable.");
		}
		return storageDir;
	});
}

async function writeFakeAgentTurnHelper(scriptPath: string): Promise<void> {
	await writeFile(
		scriptPath,
		`import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const [, , targetPath, payloadPath, workspaceDir, sessionId, turnId] = process.argv;
if (!targetPath || !payloadPath || !workspaceDir || !sessionId || !turnId) {
	throw new Error("Usage: fake-agent-turn.mjs <targetPath> <payloadPath> <workspaceDir> <sessionId> <turnId>");
}

const hookNode = process.env.FLASHTYPE_AGENT_HOOK_NODE;
const hookScript = process.env.FLASHTYPE_AGENT_HOOK_SCRIPT;
if (!hookNode || !hookScript) {
	throw new Error("Missing Flashtype agent hook environment.");
}

await runHook("UserPromptSubmit", "turn-start");
await writeFile(targetPath, await readFile(payloadPath));
await runHook("Stop", "turn-stop");
console.log(\`fake agent turn complete \${turnId}\`);

async function runHook(hookEventName, phase) {
	await new Promise((resolve, reject) => {
		const child = spawn(hookNode, [hookScript, "codex", phase], {
			cwd: workspaceDir,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.stdin.end(
			JSON.stringify({
				hook_event_name: hookEventName,
				session_id: sessionId,
				turn_id: turnId,
				cwd: workspaceDir,
			}),
		);
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0 && signal === null) {
				resolve();
				return;
			}
			reject(
				new Error(
					\`\${phase} hook failed with code=\${code} signal=\${signal} stderr=\${stderr}\`,
				),
			);
		});
	});
}
`,
		"utf8",
	);
}

function nextToken(rng: seedrandom.PRNG): string {
	return Math.floor(rng() * 0x1_0000_0000)
		.toString(36)
		.padStart(7, "0");
}

function markdownForOperation(
	kind: "agent" | "manual",
	index: number,
	token: string,
): string {
	return `${kind} op ${index.toString().padStart(4, "0")} ${token}\n`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
