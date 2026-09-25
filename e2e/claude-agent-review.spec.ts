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

test.skip(process.platform === "win32", "fake Claude helper is POSIX-only");

test("Claude terminal launches and exposes file-scoped Keep and Undo", async ({
	browserName: _browserName,
}, testInfo) => {
	const userDataDir = testInfo.outputPath("user-data");
	const workspaceDir = testInfo.outputPath("workspace");
	const welcomeFilePath = path.join(workspaceDir, "welcome.md");
	const changelogFilePath = path.join(workspaceDir, "changelog.md");
	const fakeBinDir = testInfo.outputPath("fake-bin");
	const completionPath = testInfo.outputPath("fake-claude-complete");
	const baselinePath = testInfo.outputPath("fake-claude-baseline");
	const continuePath = testInfo.outputPath("fake-claude-continue");
	let electronApp: ElectronApplication | undefined;

	try {
		await writeStarterFiles(workspaceDir);
		const initialChangelogOnDisk = await readFile(changelogFilePath, "utf8");
		await writeFakeClaude(fakeBinDir);
		electronApp = await launchDevElectronAppWithArgs([workspaceDir], {
			userDataDir,
			env: {
				PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
				SHELL: "/bin/sh",
				FLASHTYPE_E2E_CLAUDE_COMPLETION_PATH: completionPath,
				FLASHTYPE_E2E_CLAUDE_BASELINE_PATH: baselinePath,
				FLASHTYPE_E2E_CLAUDE_CONTINUE_PATH: continuePath,
			},
		});
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);
		await openWelcomeMarkdown(page);

		await page
			.getByRole("button", { name: "Start Claude Code", exact: true })
			.click();
		await expect
			.poll(() => readCompletionMarker(baselinePath), {
				message: "the baseline import did not complete",
				timeout: 30_000,
			})
			.toBe(workspaceDir);
		const initialChangelogInLix = await readLixMarkdown(page, "/changelog.md");
		await writeFile(continuePath, "continue\n");
		await expect(
			page.locator('[data-active="true"][data-view-key="flashtype_claude"]'),
		).toBeVisible();
		await expect(page.locator(".xterm-screen").first()).toBeVisible();
		await expect
			.poll(() =>
				page
					.locator(".xterm-viewport")
					.first()
					.evaluate((element) => getComputedStyle(element).backgroundColor),
			)
			.toBe("rgb(255, 255, 255)");
		await expect
			.poll(() =>
				page
					.locator(".xterm-rows")
					.first()
					.evaluate((element) => getComputedStyle(element).color),
			)
			.toBe("rgb(28, 25, 23)");
		await expect
			.poll(() => readCompletionMarker(completionPath), {
				message: "the fake Claude command did not complete",
				timeout: 30_000,
			})
			.toBe(workspaceDir);
		await expect
			.poll(async () => await readFile(welcomeFilePath, "utf8"), {
				timeout: 30_000,
			})
			.toContain("Claude e2e edit");
		await expect
			.poll(async () => await readFile(changelogFilePath, "utf8"))
			.toContain("Claude second-file edit");

		const review = page.getByRole("group", { name: "Diff review actions" });
		await expect(review).toBeVisible();
		await expect(review).toHaveAttribute(
			"data-diff-float-mode",
			"review-applied",
		);
		await expect(
			review.getByRole("button", { name: "Keep", exact: true }),
		).toBeVisible();
		await expect(
			review.getByRole("button", { name: "Undo", exact: true }),
		).toBeVisible();

		const scopeChip = review.locator('[data-attr="diff-scope-chip"]');
		await expect(scopeChip).toHaveAttribute("data-file-count", "2");
		await scopeChip.click();
		const fileChoices = review.getByRole("group", {
			name: "Files in the working set",
		});
		const welcomeChoice = fileChoices
			.locator('[data-attr="diff-scope-file"]')
			.filter({ hasText: "welcome.md" });
		const changelogChoice = fileChoices
			.locator('[data-attr="diff-scope-file"]')
			.filter({ hasText: "changelog.md" });
		await expect(welcomeChoice).toHaveCount(1);
		await expect(changelogChoice).toHaveCount(1);
		if ((await welcomeChoice.getAttribute("aria-checked")) === "true") {
			await welcomeChoice.click();
		}
		if ((await changelogChoice.getAttribute("aria-checked")) !== "true") {
			await changelogChoice.click();
		}
		await expect(welcomeChoice).toHaveAttribute("aria-checked", "false");
		await expect(changelogChoice).toHaveAttribute("aria-checked", "true");
		await expect(scopeChip).toHaveAttribute(
			"aria-label",
			"Working set: 1 of 2 files",
		);
		await review.getByRole("button", { name: "Undo", exact: true }).click();

		await expect
			.poll(() => readLixMarkdown(page, "/changelog.md"))
			.toBe(initialChangelogInLix);
		await expect
			.poll(async () => await readFile(changelogFilePath, "utf8"))
			.toBe(initialChangelogOnDisk);
		await expect
			.poll(async () => await readFile(welcomeFilePath, "utf8"))
			.toContain("Claude e2e edit");
		await expect(review).toBeVisible();
		await expect(
			review.getByText("welcome.md", { exact: true }).last(),
		).toBeVisible();
		// A single file has no scope picker; undoing one file shrinks the
		// two-file review to the remaining file and removes the picker.
		await expect(scopeChip).toHaveCount(0);
		await review.getByRole("button", { name: "Keep", exact: true }).click();
		await expect(review).toHaveCount(0);
		await expect
			.poll(async () => await readFile(welcomeFilePath, "utf8"))
			.toContain("Claude e2e edit");
		await expect
			.poll(async () => await readFile(changelogFilePath, "utf8"))
			.toBe(initialChangelogOnDisk);
	} finally {
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

async function writeFakeClaude(binDir: string): Promise<void> {
	await mkdir(binDir, { recursive: true });
	const scriptPath = path.join(binDir, "claude");
	await writeFile(
		scriptPath,
		`#!/bin/sh
set -eu

case " $* " in
	*" --version "*)
		printf '%s\\n' '2.1.78 (Claude Code)'
		exit 0
		;;
esac

run_hook() {
	event_name="$1"
	phase="$2"
	printf '{"hook_event_name":"%s","session_id":"e2e-claude-session","turn_id":"e2e-claude-turn","cwd":"%s"}' "$event_name" "$PWD" |
		ELECTRON_RUN_AS_NODE=1 "$FLASHTYPE_AGENT_HOOK_NODE" "$FLASHTYPE_AGENT_HOOK_SCRIPT" claude "$phase"
}

run_hook UserPromptSubmit turn-start
printf '%s\\n' "$PWD" > "$FLASHTYPE_E2E_CLAUDE_BASELINE_PATH"
while [ ! -f "$FLASHTYPE_E2E_CLAUDE_CONTINUE_PATH" ]; do sleep 0.05; done
printf '\\nClaude e2e edit.\\n' >> welcome.md
printf '\\nClaude second-file edit.\\n' >> changelog.md
run_hook Stop turn-stop
printf '%s\\n' "$PWD" > "$FLASHTYPE_E2E_CLAUDE_COMPLETION_PATH"
printf '%s\\n' 'fake claude complete'
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

async function readLixMarkdown(page: Page, filePath: string): Promise<string> {
	return await page.evaluate(async (path) => {
		const desktop = window.flashtypeDesktop;
		if (!desktop) throw new Error("Flashtype desktop bridge is unavailable.");
		const result = await desktop.lix.execute({
			sql: "SELECT content FROM lix_file WHERE path = $1",
			params: [path],
		});
		const row = result.rows[0];
		if (row === undefined) throw new Error(`No file row returned for ${path}.`);
		const content = Array.isArray(row)
			? row[0]
			: (row as Record<string, unknown>).content;
		if (content instanceof Uint8Array) return new TextDecoder().decode(content);
		if (Array.isArray(content))
			return new TextDecoder().decode(new Uint8Array(content as number[]));
		if (content && typeof content === "object")
			return new TextDecoder().decode(
				new Uint8Array(Object.values(content) as number[]),
			);
		if (typeof content === "string") return content;
		throw new Error(`Unexpected Lix content value: ${String(content)}`);
	}, filePath);
}
