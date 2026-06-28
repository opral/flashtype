import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
const operationCount = 1_000;
const stressSeed = "workspace-change-stress-e2e-v1";
const initialMarkdown = "seed\n";
const lixTracePrefix = "[lix-ipc-trace]";

test.skip(
	process.platform === "win32",
	"fake agent shell helper is POSIX-only",
);
test.skip(!existsSync("/bin/sh"), "fake agent shell helper requires /bin/sh");
test.setTimeout(3_600_000);

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

	try {
		await mkdir(workspaceDir, { recursive: true });
		await mkdir(payloadDir, { recursive: true });
		await writeFile(stressDiskPath, expectedMarkdown, "utf8");
		await writeFakeAgentTurnHelper(helperScriptPath);

		electronApp = await launchDevElectronApp(workspaceDir, {
			env: {
				FLASHTYPE_TRACE_LIX_IPC: "1",
				FLASHTYPE_TRACE_LIX_SLOW_MS: "0",
			},
			userDataDir,
		});
		traceCapture = startLixTraceCapture(electronApp);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await openStressMarkdown(page);
		await installStressEditorHelpers(page);
		await expectMarkdownSettled({
			diskPath: stressDiskPath,
			expectedMarkdown,
			page,
		});

		for (let index = 0; index < operationCount; index += 1) {
			const token = nextToken(rng);
			const kind = rng() < 0.5 ? "manual" : "agent";
			const line = `${kind} op ${index.toString().padStart(4, "0")} ${token}`;

			if (kind === "manual") {
				expectedMarkdown = appendParagraph(expectedMarkdown, line);
				await applyManualEdit(page, line);
				await expectMarkdownSettled({
					diskPath: stressDiskPath,
					expectedMarkdown,
					page,
				});
			} else {
				const beforeAgentMarkdown = expectedMarkdown;
				const proposedMarkdown = appendParagraph(beforeAgentMarkdown, line);
				const keep = rng() < 0.5;
				const payloadPath = path.join(
					payloadDir,
					`agent-${index.toString().padStart(4, "0")}.md`,
				);
				await writeFile(payloadPath, proposedMarkdown, "utf8");
				await runFakeAgentTurn(page, {
					helperScriptPath,
					payloadPath,
					sessionId: "workspace-change-stress",
					turnId: `turn-${index.toString().padStart(4, "0")}`,
					workspaceDir,
				});
				await waitForReviewControls(page);
				await page
					.getByRole("button", { name: keep ? "Keep" : "Undo" })
					.click();
				await expect(
					page.getByRole("group", { name: "External write review actions" }),
				).toBeHidden({ timeout: 30_000 });

				expectedMarkdown = keep ? proposedMarkdown : beforeAgentMarkdown;
				await expectMarkdownSettled({
					diskPath: stressDiskPath,
					expectedMarkdown,
					page,
				});
			}

			if ((index + 1) % 100 === 0) {
				console.log(
					`[workspace-change-stress] completed ${index + 1}/${operationCount}`,
				);
			}
		}

		await expectMarkdownSettled({
			diskPath: stressDiskPath,
			expectedMarkdown,
			page,
			timeout: 60_000,
		});
	} finally {
		await closeElectronApp(electronApp);
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
		page.locator('[data-active="true"][data-view-key="flashtype_file"]'),
	).toBeVisible();
}

async function applyManualEdit(page: Page, line: string): Promise<void> {
	await focusEditorEnd(page);
	await page.keyboard.press("Enter");
	await page.keyboard.type(line);
}

async function runFakeAgentTurn(
	page: Page,
	args: {
		helperScriptPath: string;
		payloadPath: string;
		sessionId: string;
		turnId: string;
		workspaceDir: string;
	},
): Promise<void> {
	const command = [
		"ELECTRON_RUN_AS_NODE=1",
		'"$FLASHTYPE_AGENT_HOOK_NODE"',
		shellQuote(args.helperScriptPath),
		shellQuote(stressFileName),
		shellQuote(args.payloadPath),
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

async function expectMarkdownSettled(args: {
	diskPath: string;
	expectedMarkdown: string;
	page: Page;
	timeout?: number;
}): Promise<void> {
	await expect
		.poll(
			async () => {
				const [editorMarkdown, lixMarkdown, diskMarkdown] = await Promise.all([
					readEditorMarkdown(args.page),
					readPersistedMarkdown(args.page, stressAppPath),
					readDiskMarkdown(args.diskPath),
				]);
				return { diskMarkdown, editorMarkdown, lixMarkdown };
			},
			{ timeout: args.timeout ?? 30_000 },
		)
		.toEqual({
			diskMarkdown: args.expectedMarkdown,
			editorMarkdown: args.expectedMarkdown,
			lixMarkdown: args.expectedMarkdown,
		});
}

async function readDiskMarkdown(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf8");
	} catch {
		return null;
	}
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
			focusEnd() {
				const editor = requireEditor();
				const point = endPointFor(editor);
				editor.focus({ preventScroll: true });
				const selection = window.getSelection();
				if (!selection) {
					throw new Error("Window selection is unavailable.");
				}
				const range = document.createRange();
				range.setStart(point.node, point.offset);
				range.collapse(true);
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

		function endPointFor(editor: HTMLElement): { node: Node; offset: number } {
			const lastBlock = Array.from(editor.children).at(-1);
			if (!lastBlock) {
				return { node: editor, offset: 0 };
			}
			const walker = document.createTreeWalker(lastBlock, NodeFilter.SHOW_TEXT);
			let lastText: Node | null = null;
			while (walker.nextNode()) {
				lastText = walker.currentNode;
			}
			if (lastText) {
				return { node: lastText, offset: lastText.textContent?.length ?? 0 };
			}
			return { node: lastBlock, offset: lastBlock.childNodes.length };
		}
	});
}

async function focusEditorEnd(page: Page): Promise<void> {
	await page.evaluate(() => {
		const api = (window as any).__flashtypeWorkspaceStress;
		if (!api) {
			throw new Error("Workspace stress editor helpers are not installed.");
		}
		api.focusEnd();
	});
}

async function readEditorMarkdown(page: Page): Promise<string | null> {
	return await page.evaluate(() => {
		const api = (window as any).__flashtypeWorkspaceStress;
		if (!api) return null;
		return api.markdown();
	});
}

async function writeFakeAgentTurnHelper(scriptPath: string): Promise<void> {
	await writeFile(
		scriptPath,
		`import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [, , relativePath, payloadPath, sessionId, turnId] = process.argv;
if (!relativePath || !payloadPath || !sessionId || !turnId) {
	throw new Error("Usage: fake-agent-turn.mjs <relativePath> <payloadPath> <sessionId> <turnId>");
}

const hookNode = process.env.FLASHTYPE_AGENT_HOOK_NODE;
const hookScript = process.env.FLASHTYPE_AGENT_HOOK_SCRIPT;
if (!hookNode || !hookScript) {
	throw new Error("Missing Flashtype agent hook environment.");
}

await runHook("UserPromptSubmit", "turn-start");
await writeFile(join(process.cwd(), relativePath), await readFile(payloadPath));
await runHook("Stop", "turn-stop");
console.log(\`fake agent turn complete \${turnId}\`);

async function runHook(hookEventName, phase) {
	await new Promise((resolve, reject) => {
		const child = spawn(hookNode, [hookScript, "codex", phase], {
			cwd: process.cwd(),
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
				cwd: process.cwd(),
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

function appendParagraph(markdown: string, paragraph: string): string {
	const body = markdown.endsWith("\n") ? markdown.slice(0, -1) : markdown;
	return body.length === 0 ? `${paragraph}\n` : `${body}\n\n${paragraph}\n`;
}

function nextToken(rng: seedrandom.PRNG): string {
	return Math.floor(rng() * 0x1_0000_0000)
		.toString(36)
		.padStart(7, "0");
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
