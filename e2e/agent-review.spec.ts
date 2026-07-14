import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { chmod, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
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

test("Atelier reveals a review after Codex edits restored markdown", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const workspaceDir = testInfo.outputPath("workspace");
	const welcomeFilePath = path.join(workspaceDir, "welcome.md");
	const changelogFilePath = path.join(workspaceDir, "changelog.md");
	const createdFilePath = path.join(workspaceDir, "codex-created.md");
	const fakeBinDir = testInfo.outputPath("fake-bin");
	const fakeCodexCompletionPath = testInfo.outputPath("fake-codex-complete");
	const originalPath = process.env.PATH;
	const originalShell = process.env.SHELL;
	const originalCompletionPath =
		process.env.FLASHTYPE_E2E_CODEX_COMPLETION_PATH;

	let electronApp: ElectronApplication | undefined;
	try {
		await writeStarterFiles(workspaceDir);
		const newestMarkdownTime = new Date(Date.now() + 1_000);
		await utimes(welcomeFilePath, newestMarkdownTime, newestMarkdownTime);
		await writeFile(
			path.join(workspaceDir, "binary.bin"),
			new Uint8Array([0x80, 0xff, 0x00]),
		);
		await writeFakeCodex(fakeBinDir);
		process.env.PATH = `${fakeBinDir}:${originalPath ?? ""}`;
		process.env.SHELL = "/bin/sh";
		process.env.FLASHTYPE_E2E_CODEX_COMPLETION_PATH = fakeCodexCompletionPath;

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

		await page.locator('[data-attr="agent-start-codex"]').click();
		await expect(
			page.locator('[data-active="true"][data-view-key="flashtype_codex"]'),
		).toBeVisible();
		await expect
			.poll(() => readCompletionMarker(fakeCodexCompletionPath), {
				message: "the fake Codex command did not complete",
				timeout: 30_000,
			})
			.toBe("complete");
		await expect
			.poll(async () => await readFile(welcomeFilePath, "utf8"), {
				timeout: 30_000,
			})
			.toContain("Codex e2e edit");
		await expect
			.poll(async () => await readFile(changelogFilePath, "utf8"))
			.toContain("Codex unopened edit");
		await expect
			.poll(async () => await readFile(createdFilePath, "utf8"))
			.toContain("Codex created file");

		await expect(
			page.getByRole("group", { name: /^Review change 1 of \d+$/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Keep change" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Undo change" }),
		).toBeVisible();
		await ensureFilesViewOpenInLeftPanel(page);
		await expect(fileTreeFile(page, "/changelog.md")).toHaveAttribute(
			"data-item-git-status",
			"modified",
		);
		await expect(fileTreeFile(page, "/codex-created.md")).toHaveAttribute(
			"data-item-git-status",
			"modified",
		);
	} finally {
		process.env.PATH = originalPath;
		if (originalShell === undefined) {
			delete process.env.SHELL;
		} else {
			process.env.SHELL = originalShell;
		}
		if (originalCompletionPath === undefined) {
			delete process.env.FLASHTYPE_E2E_CODEX_COMPLETION_PATH;
		} else {
			process.env.FLASHTYPE_E2E_CODEX_COMPLETION_PATH = originalCompletionPath;
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
		page.locator('[data-active="true"][data-view-key="atelier_file"]'),
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
			}, "atelier_ui_state");
		})
		.toContain(filePath);
}

async function writeFakeCodex(binDir: string): Promise<void> {
	await mkdir(binDir, { recursive: true });
	const scriptPath = path.join(binDir, "codex");
	await writeFile(
		scriptPath,
		`#!/bin/sh
set -eu

case " $* " in
	*" --version "*)
		printf '%s\\n' 'codex-cli 0.134.0'
		exit 0
		;;
esac

run_hook() {
	event_name="$1"
	phase="$2"
	printf '{"hook_event_name":"%s","session_id":"e2e-codex-session","turn_id":"e2e-codex-turn","cwd":"%s"}' "$event_name" "$PWD" |
		ELECTRON_RUN_AS_NODE=1 "$FLASHTYPE_AGENT_HOOK_NODE" "$FLASHTYPE_AGENT_HOOK_SCRIPT" codex "$phase"
}

run_hook UserPromptSubmit turn-start
printf '\\nCodex e2e edit.\\n' >> welcome.md
printf '\\nCodex unopened edit.\\n' >> changelog.md
printf '# Codex created file\\n' > codex-created.md
run_hook Stop turn-stop
printf '%s\\n' 'complete' > "$FLASHTYPE_E2E_CODEX_COMPLETION_PATH"
printf '%s\\n' 'fake codex complete'
`,
		"utf8",
	);
	await chmod(scriptPath, 0o755);
}

async function readCompletionMarker(filePath: string): Promise<string> {
	try {
		return (await readFile(filePath, "utf8")).trim();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "pending";
		throw error;
	}
}
