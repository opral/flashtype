import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeFile,
	launchDevElectronAppWithArgs,
	registerRendererConsoleLogging,
	writeStarterFiles,
} from "./electron-test-utils";

test.skip(process.platform === "win32", "fake codex helper is POSIX-only");

test.skip("restored markdown file shows a review after Codex edits it", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const workspaceDir = testInfo.outputPath("workspace");
	const fakeBinDir = testInfo.outputPath("fake-bin");
	const originalPath = process.env.PATH;
	const originalShell = process.env.SHELL;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		await writeFile(
			path.join(workspaceDir, "binary.bin"),
			new Uint8Array([0x80, 0xff, 0x00]),
		);
		await writeFakeCodex(fakeBinDir);
		process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;
		process.env.SHELL = "/bin/sh";

		electronApp = await launchDevElectronAppWithArgs([workspaceDir], {
			userDataDir,
		});
		let page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await openWelcomeMarkdown(page);
		await expectOpenFilePersisted(page, "/welcome.md");

		await closeElectronApp(electronApp);
		electronApp = undefined;

		electronApp = await launchDevElectronAppWithArgs([], { userDataDir });
		page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page).toHaveTitle(path.basename(workspaceDir));
		await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();

		await page.getByRole("button", { name: "Use Codex instead" }).click();
		await expect
			.poll(
				async () =>
					await readFile(path.join(workspaceDir, "welcome.md"), "utf8"),
			)
			.toContain("Codex e2e edit");

		await expect(
			page.getByRole("group", { name: "External write review actions" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Keep" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
	} finally {
		process.env.PATH = originalPath;
		if (originalShell === undefined) {
			delete process.env.SHELL;
		} else {
			process.env.SHELL = originalShell;
		}
		await closeElectronApp(electronApp);
	}
});

async function openWelcomeMarkdown(page: Page): Promise<void> {
	await ensureFilesViewOpenInLeftPanel(page);
	const file = fileTreeFile(page, "/welcome.md");
	await expect(file).toBeVisible();
	await file.click();
	await expect(file).toHaveAttribute("data-item-selected", "true");
	await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
	await expect(
		page.locator('[data-active="true"][data-view-key="flashtype_file"]'),
	).toBeVisible();
}

async function expectOpenFilePersisted(
	page: Page,
	filePath: string,
): Promise<void> {
	await expect
		.poll(async () => {
			return await page.evaluate(async (key) => {
				const result = await window.flashtypeDesktop?.lix.execute({
					sql: "SELECT value FROM lix_key_value_by_branch WHERE key = $1 AND lixcol_branch_id = 'global'",
					params: [key],
				});
				return JSON.stringify(result?.rows?.[0]?.[0] ?? null);
			}, "flashtype_ui_state");
		})
		.toContain(filePath);
}

async function writeFakeCodex(binDir: string): Promise<void> {
	await mkdir(binDir, { recursive: true });
	const scriptPath = path.join(binDir, "codex");
	await writeFile(
		scriptPath,
		`#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const configs = [];
for (let index = 0; index < args.length; index += 1) {
	if (args[index] === "-c") {
		configs.push(args[index + 1] ?? "");
		index += 1;
	}
}

await runHook("UserPromptSubmit", "turn-start");
await appendFile(join(process.cwd(), "welcome.md"), "\\nCodex e2e edit.\\n");
await runHook("Stop", "turn-stop");
console.log("fake codex complete");

async function runHook(eventName, phase) {
	const command = hookCommand(eventName);
	if (!command) {
		throw new Error(\`Missing \${eventName} hook command\`);
	}
	await new Promise((resolve, reject) => {
		const child = spawn(command, {
			cwd: process.cwd(),
			env: process.env,
			shell: true,
			stdio: ["pipe", "ignore", "inherit"],
		});
		child.stdin.end(
			JSON.stringify({
				hook_event_name: eventName,
				session_id: "e2e-codex-session",
				turn_id: "e2e-codex-turn",
				cwd: process.cwd(),
			}),
		);
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(\`\${phase} hook exited with code \${code}\`));
			}
		});
	});
}

function hookCommand(eventName) {
	const config = configs.find((candidate) =>
		candidate.includes(\`hooks.\${eventName}=\`),
	);
	if (!config) return null;
	const prefix = 'command="';
	const start = config.indexOf(prefix);
	if (start === -1) return null;
	let raw = "";
	let escaped = false;
	for (let index = start + prefix.length; index < config.length; index += 1) {
		const char = config[index];
		if (escaped) {
			raw += \`\\\\\${char}\`;
			escaped = false;
			continue;
		}
		if (char === "\\\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			break;
		}
		raw += char;
	}
	return JSON.parse(\`"\${raw}"\`);
}
`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);
}
