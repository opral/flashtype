import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import { FsBackend, openLix } from "@lix-js/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	ensureHistoryViewOpenInLeftPanel,
	expectPathMissing,
	fileTreeFile,
	launchDevElectronApp,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

test("persistent workspace branch switching keeps sidebar and disk on the active branch", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("persistent-branch-workspace");
	const sharedPath = path.join(workspaceDir, "shared.md");
	const draftOnlyPath = path.join(workspaceDir, "draft-only.md");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(sharedPath, "# Main shared\n", "utf8");
		await writeFile(
			path.join(workspaceDir, "main-only.md"),
			"# Main only\n",
			"utf8",
		);
		await initializeLixWorkspace(workspaceDir);

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await ensureFilesViewOpenInLeftPanel(page);
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expect(fileTreeFile(page, "/main-only.md")).toBeVisible();
		await ensureHistoryViewOpenInLeftPanel(page);
		await expectCurrentCheckpointActive(page);

		await createCheckpointFromUi(page);
		await expectCurrentCheckpointActive(page);

		await switchBranchFromUi(page, "Naming checkpoint...");
		await expectCheckpointActive(page, "Naming checkpoint...");

		await ensureFilesViewOpenInLeftPanel(page);
		await writeDraftBranchState(page);
		await expect(fileTreeFile(page, "/draft-only.md")).toBeVisible();
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expectDiskText(sharedPath, "# Draft shared\n");
		await expectDiskText(draftOnlyPath, "# Draft only\n");

		await switchBranchFromUi(page, "Current Checkpoint");
		await expectCurrentCheckpointActive(page);
		await ensureFilesViewOpenInLeftPanel(page);
		await expect(fileTreeFile(page, "/shared.md")).toBeVisible();
		await expect(fileTreeFile(page, "/main-only.md")).toBeVisible();
		await expect(fileTreeFile(page, "/draft-only.md")).toHaveCount(0);
		await expectDiskText(sharedPath, "# Main shared\n");
		await expectPathMissing(draftOnlyPath);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("ephemeral workspace shows enabled branch UI", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("ephemeral-branch-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(path.join(workspaceDir, "note.md"), "# Note\n", "utf8");

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await ensureFilesViewOpenInLeftPanel(page);
		await expect(fileTreeFile(page, "/note.md")).toBeVisible();
		await expectPathMissing(path.join(workspaceDir, ".lix"));

		await ensureHistoryViewOpenInLeftPanel(page);
		await expectCurrentCheckpointActive(page);
		await expect(
			page.getByRole("button", { name: "Create checkpoint" }),
		).toBeVisible();
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("checkpoint row click marks files without auto-opening a diff", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("checkpoint-diff-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await writeFile(path.join(workspaceDir, "seed.md"), "# Seed\n", "utf8");
		await initializeLixWorkspace(workspaceDir);

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		const setup = await createCheckpointDiffBranches(page);

		await ensureHistoryViewOpenInLeftPanel(page);
		await expect
			.poll(async () => await checkpointRowLabels(page))
			.toEqual(["a-previous", "b-target", "Current Checkpoint"]);

		const targetCheckpoint = page.getByRole("button", {
			name: "b-target",
			exact: true,
		});
		await targetCheckpoint.click();
		await expect(targetCheckpoint).toHaveAttribute("data-selected", "true");
		await expect(targetCheckpoint).not.toHaveAttribute("aria-current", "true");
		await expect
			.poll(async () => await activeBranchIdFromUi(page))
			.toBe(setup.activeBranchId);
		await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);

		await ensureFilesViewOpenInLeftPanel(page);
		for (const filePath of ["/added.md", "/removed.md", "/shared.md"]) {
			const file = fileTreeFile(page, filePath);
			await expect(file).toBeVisible();
			await expect(file).toHaveAttribute("data-item-git-status", "modified");
		}

		await fileTreeFile(page, "/added.md").click();
		await expect(page.locator(".markdown-review-overlay")).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay [data-diff-status]").first(),
		).toBeVisible();
		await expect(page.getByText("Added only in target")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Keep", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Undo", exact: true }),
		).toHaveCount(0);

		await fileTreeFile(page, "/shared.md").click();
		await expect(page.locator(".markdown-review-overlay")).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay [data-diff-status]").first(),
		).toBeVisible();
		await expect(
			page
				.locator(".markdown-review-overlay [data-diff-status='removed']")
				.filter({ hasText: "Previous" }),
		).toBeVisible();
		await expect(
			page
				.locator(".markdown-review-overlay [data-diff-status='added']")
				.filter({ hasText: "Target" }),
		).toBeVisible();
		await expect(
			page.locator(".markdown-review-overlay").getByText("snapshot"),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Keep", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Undo", exact: true }),
		).toHaveCount(0);
		await expect
			.poll(async () => await activeBranchIdFromUi(page))
			.toBe(setup.activeBranchId);
	} finally {
		await closeElectronApp(electronApp);
	}
});

test("checkpoint diff selection keeps the active editor and toggles revision state", async ({
	browserName: _browserName,
}, testInfo) => {
	const workspaceDir = testInfo.outputPath("checkpoint-editor-revision-workspace");

	let electronApp: ElectronApplication | undefined;
	try {
		await mkdir(workspaceDir, { recursive: true });
		await initializeLixWorkspace(workspaceDir);

		electronApp = await launchDevElectronApp(workspaceDir);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await createMarkdownFileFromUi(page, "foo");
		await typeLineInActiveMarkdown(page, "/foo.md", "foo line one");

		const checkpoint1Id = await createCheckpointFromUi(page);
		await waitForNextRendererTimestampSecond(page);

		await openMarkdownFileFromTree(page, "/foo.md");
		await typeLineInActiveMarkdown(page, "/foo.md", "foo line two");
		await createMarkdownFileFromUi(page, "bar");
		await typeLineInActiveMarkdown(page, "/bar.md", "bar line one");

		const checkpoint2Id = await createCheckpointFromUi(page);
		const currentBranchId = await activeBranchIdFromUi(page);
		if (!currentBranchId) {
			throw new Error("Active branch id is unavailable.");
		}
		await expectHistoryBranchOrder(page, [
			checkpoint1Id,
			checkpoint2Id,
			currentBranchId,
		]);

		await openMarkdownFileFromTree(page, "/foo.md");
		await typeLineInActiveMarkdown(page, "/foo.md", "foo line three");
		await openMarkdownFileFromTree(page, "/bar.md");
		await typeLineInActiveMarkdown(page, "/bar.md", "bar line two");

		await clickCheckpointRow(page, 1);
		await expectActiveCentralFile(page, "/bar.md");
		await expectMarkdownDiff(page, { added: ["bar line one"] });

		await openMarkdownFileFromTree(page, "/foo.md");
		await expectActiveCentralFile(page, "/foo.md");
		await expectMarkdownDiff(page, { added: ["foo line two"] });

		await clickCheckpointRow(page, 1);
		await expectActiveCentralFile(page, "/foo.md");
		await expectEditableMarkdown(page);

		await clickCheckpointRow(page, 1);
		await expectActiveCentralFile(page, "/foo.md");
		await expectMarkdownDiff(page, { added: ["foo line two"] });

		await clickCheckpointRow(page, 0);
		await expectActiveCentralFile(page, "/foo.md");
		await expectMarkdownDiff(page);
	} finally {
		await closeElectronApp(electronApp);
	}
});

async function initializeLixWorkspace(workspaceDir: string): Promise<void> {
	const lix = await openLix({
		backend: new FsBackend({ path: workspaceDir, syncAllFiles: true }),
	});
	await lix.close();
}

async function createMarkdownFileFromUi(
	page: Page,
	stem: string,
): Promise<void> {
	const appPath = `/${stem}.md`;
	await ensureFilesViewOpenInLeftPanel(page);
	await page.getByRole("button", { name: "New file", exact: true }).click();
	const renameInput = page.locator("[data-item-rename-input]").first();
	await expect(renameInput).toBeVisible();
	await renameInput.fill(stem);
	await renameInput.press("Enter");
	await expect(fileTreeFile(page, appPath)).toBeVisible();
	await expectActiveCentralFile(page, appPath);
	await expectEditableMarkdown(page);
}

async function openMarkdownFileFromTree(
	page: Page,
	appPath: string,
): Promise<void> {
	await ensureFilesViewOpenInLeftPanel(page);
	const file = fileTreeFile(page, appPath);
	await expect(file).toBeVisible();
	await file.click();
	await expectActiveCentralFile(page, appPath);
}

async function typeLineInActiveMarkdown(
	page: Page,
	appPath: string,
	line: string,
): Promise<void> {
	const editor = page.locator('[data-testid="tiptap-editor"] .ProseMirror');
	await expect(editor).toBeVisible();
	await focusEditableMarkdownEnd(page, editor);
	const existingText = (await editor.innerText()).trim();
	if (existingText.length > 0) {
		await page.keyboard.press("Enter");
	}
	await page.keyboard.type(line);
	await expect(editor).toContainText(line);
	await expectLixFileToContain(page, appPath, line);
}

async function focusEditableMarkdownEnd(
	page: Page,
	editor: ReturnType<Page["locator"]>,
): Promise<void> {
	await editor.click();
	await page.keyboard.press(
		process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End",
	);
}

async function waitForNextRendererTimestampSecond(page: Page): Promise<void> {
	const startedAtSecond = await page.evaluate(() =>
		Math.floor(Date.now() / 1000),
	);
	await expect
		.poll(async () => await page.evaluate(() => Math.floor(Date.now() / 1000)))
		.not.toBe(startedAtSecond);
}

async function createCheckpointFromUi(page: Page): Promise<string> {
	const beforeIds = await branchIdsFromUi(page);
	await ensureHistoryViewOpenInLeftPanel(page);
	await page.getByRole("button", { name: "Create checkpoint" }).click();
	await expect(
		page.getByRole("button", { name: "Naming checkpoint...", exact: true }),
	).toBeVisible();
	await expect
		.poll(async () => await newBranchIdFromUi(page, beforeIds))
		.not.toBeNull();
	const branchId = await newBranchIdFromUi(page, beforeIds);
	if (!branchId) {
		throw new Error("Created checkpoint branch was not found.");
	}
	return branchId;
}

async function expectHistoryBranchOrder(
	page: Page,
	expectedBranchIds: readonly string[],
): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await expect
		.poll(async () => await visibleBranchIdsInHistoryOrderFromUi(page))
		.toEqual(expectedBranchIds);
	const rows = page.locator('[data-attr="branch-diff"]');
	await expect(rows).toHaveCount(expectedBranchIds.length);
	await expect(rows.nth(expectedBranchIds.length - 1)).toContainText(
		"Current Checkpoint",
	);
}

async function clickCheckpointRow(page: Page, rowIndex: number): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	const checkpoint = page.locator('[data-attr="branch-diff"]').nth(rowIndex);
	await expect(checkpoint).toBeVisible();
	await checkpoint.click();
}

async function switchBranchFromUi(
	page: Page,
	branchName: string,
): Promise<void> {
	await ensureHistoryViewOpenInLeftPanel(page);
	await page
		.getByRole("button", {
			name: `Checkpoint actions for ${branchName}`,
			exact: true,
		})
		.click();
	await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
}

async function expectCurrentCheckpointActive(page: Page): Promise<void> {
	await expectCheckpointActive(page, "Current Checkpoint");
}

async function expectCheckpointActive(
	page: Page,
	checkpointName: string,
): Promise<void> {
	const checkpoint = page.getByRole("button", {
		name: checkpointName,
		exact: true,
	});
	await expect(checkpoint).toBeEnabled();
	await expect(checkpoint).toHaveAttribute("aria-current", "true");
}

async function writeDraftBranchState(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const encoder = new TextEncoder();
		await window.flashtypeDesktop?.lix.execute({
			sql: "UPDATE lix_file SET data = $1 WHERE path = $2",
			params: [encoder.encode("# Draft shared\n"), "/shared.md"],
		});
		await window.flashtypeDesktop?.lix.execute({
			sql: "INSERT INTO lix_file (path, data) VALUES ($1, $2)",
			params: ["/draft-only.md", encoder.encode("# Draft only\n")],
		});
	});
}

async function expectDiskText(
	filePath: string,
	expected: string,
): Promise<void> {
	await expect
		.poll(async () => await readFile(filePath, "utf8"))
		.toBe(expected);
}

async function createCheckpointDiffBranches(
	page: Page,
): Promise<{ activeBranchId: string }> {
	return await page.evaluate(async () => {
		const lix = window.flashtypeDesktop?.lix;
		if (!lix) {
			throw new Error("Desktop Lix bridge is unavailable");
		}

		const encoder = new TextEncoder();
		const data = (text: string) => encoder.encode(text);
		const paths = ["/shared.md", "/added.md", "/removed.md"];

		await lix.execute({
			sql: "DELETE FROM lix_file WHERE path IN ($1, $2, $3)",
			params: paths,
		});
		await lix.execute({
			sql: "INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3), ($4, $5, $6)",
			params: [
				"e2e_shared",
				"/shared.md",
				data("# Shared\n\nTarget snapshot\n"),
				"e2e_added",
				"/added.md",
				data("# Added\n\nAdded only in target\n"),
			],
		});
		await lix.createBranch({ options: { name: "b-target" } });

		await lix.execute({
			sql: "UPDATE lix_file SET data = $1 WHERE id = $2",
			params: [data("# Shared\n\nPrevious snapshot\n"), "e2e_shared"],
		});
		await lix.execute({
			sql: "DELETE FROM lix_file WHERE id = $1",
			params: ["e2e_added"],
		});
		await lix.execute({
			sql: "INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3)",
			params: [
				"e2e_removed",
				"/removed.md",
				data("# Removed\n\nRemoved before target\n"),
			],
		});
		await lix.createBranch({ options: { name: "a-previous" } });

		return { activeBranchId: await lix.activeBranchId() };
	});
}

async function branchIdsFromUi(page: Page): Promise<string[]> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT id FROM lix_branch",
			params: [],
		});
		return (result?.rows ?? []).map((row) => String(row[0]));
	});
}

async function newBranchIdFromUi(
	page: Page,
	beforeIds: readonly string[],
): Promise<string | null> {
	return await page.evaluate(async (previousIds) => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT id FROM lix_branch",
			params: [],
		});
		const previous = new Set(previousIds);
		for (const row of result?.rows ?? []) {
			const id = String(row[0]);
			if (!previous.has(id)) return id;
		}
		return null;
	}, beforeIds);
}

async function visibleBranchIdsInHistoryOrderFromUi(
	page: Page,
): Promise<string[]> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: `
				SELECT id
				FROM lix_branch
				WHERE COALESCE(CAST(hidden AS TEXT), 'false') NOT IN ('true', '1', 't')
				ORDER BY name ASC
			`,
			params: [],
		});
		return (result?.rows ?? []).map((row) => String(row[0]));
	});
}

async function expectActiveCentralFile(
	page: Page,
	appPath: string,
): Promise<void> {
	await expect.poll(async () => await activeCentralFilePathFromUi(page)).toBe(
		appPath,
	);
}

async function activeCentralFilePathFromUi(
	page: Page,
): Promise<string | null> {
	return await page.evaluate(async () => {
		const result = await window.flashtypeDesktop?.lix.execute({
			sql: "SELECT value FROM lix_key_value_by_branch WHERE key = $1 AND lixcol_branch_id = $2",
			params: ["flashtype_ui_state", "global"],
		});
		const state = result?.rows?.[0]?.[0] as
			| {
					panels?: {
						central?: {
							activeInstance?: string | null;
							views?: Array<{
								instance?: string;
								state?: { filePath?: unknown };
							}>;
						};
					};
			  }
			| undefined;
		const central = state?.panels?.central;
		const views = central?.views ?? [];
		const active =
			views.find((view) => view.instance === central?.activeInstance) ??
			views[0];
		const filePath = active?.state?.filePath;
		return typeof filePath === "string" ? filePath : null;
	});
}

async function expectEditableMarkdown(page: Page): Promise<void> {
	await expect(page.locator(".markdown-review-overlay")).toHaveCount(0);
	await expect(
		page.locator('[data-testid="tiptap-editor"] .ProseMirror'),
	).toBeVisible();
	await expect(
		page.locator('[data-testid="tiptap-editor"] .ProseMirror'),
	).toHaveAttribute("contenteditable", "true");
}

async function expectMarkdownDiff(
	page: Page,
	expected: { added?: readonly string[]; removed?: readonly string[] } = {},
): Promise<void> {
	const overlay = page.locator(".markdown-review-overlay");
	await expect(overlay).toBeVisible();
	await expect(overlay.locator("[data-diff-status]").first()).toBeVisible();
	for (const text of expected.added ?? []) {
		await expect(
			overlay.locator("[data-diff-status='added']").filter({ hasText: text }),
		).toBeVisible();
	}
	for (const text of expected.removed ?? []) {
		await expect(
			overlay.locator("[data-diff-status='removed']").filter({ hasText: text }),
		).toBeVisible();
	}
	await expect(
		page.getByRole("button", { name: "Keep", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Undo", exact: true }),
	).toHaveCount(0);
}

async function expectLixFileToContain(
	page: Page,
	appPath: string,
	text: string,
): Promise<void> {
	await expect.poll(async () => await lixFileTextByPath(page, appPath)).toContain(
		text,
	);
}

async function lixFileTextByPath(
	page: Page,
	appPath: string,
): Promise<string> {
	return (
		(await page.evaluate(async (path) => {
			const result = await window.flashtypeDesktop?.lix.execute({
				sql: "SELECT data FROM lix_file WHERE path = $1",
				params: [path],
			});
			const value = result?.rows?.[0]?.[0];
			return decodeSqlText(value);

			function decodeSqlText(value: unknown): string {
				if (value instanceof Uint8Array) return new TextDecoder().decode(value);
				if (value instanceof ArrayBuffer) {
					return new TextDecoder().decode(new Uint8Array(value));
				}
				if (ArrayBuffer.isView(value)) {
					const view = value as Uint8Array;
					return new TextDecoder().decode(
						new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
					);
				}
				if (Array.isArray(value)) {
					return new TextDecoder().decode(new Uint8Array(value as number[]));
				}
				if (
					value &&
					typeof value === "object" &&
					"value" in value
				) {
					return decodeSqlText((value as { value: unknown }).value);
				}
				return typeof value === "string" ? value : "";
			}
		}, appPath)) ?? ""
	);
}

async function checkpointRowLabels(page: Page): Promise<string[]> {
	return await page
		.locator('[data-attr="branch-diff"]')
		.evaluateAll((rows) =>
			rows.map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim()),
		);
}

async function activeBranchIdFromUi(page: Page): Promise<string | undefined> {
	return await page.evaluate(async () => {
		return await window.flashtypeDesktop?.lix.activeBranchId();
	});
}
