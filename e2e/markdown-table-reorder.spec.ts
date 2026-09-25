import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	closeElectronApp,
	ensureFilesViewOpenInLeftPanel,
	fileTreeFile,
	launchDevElectronApp,
} from "./electron-test-utils";

const initialMarkdown =
	"| Name | Qty | Note |\n| --- | ---: | --- |\n| apple | 3 | ripe |\n| pear | 5 | green |\n";

test("column grip reorder is undone by one Mod-z", async () => {
	const fixture = await openTableFixture();
	try {
		const { page, editor, filePath } = fixture;
		const headerCells = editor.locator("table tbody tr:first-child th");
		await expect(headerCells).toHaveCount(3);
		await headerCells.nth(0).click();
		await expect(editor).toBeFocused();
		await dragGripToCell(page, headerCells.nth(0), headerCells.nth(2), "column");
		await expect(headerCells).toHaveText(["Qty", "Note", "Name"]);
		await expect(editor).toBeFocused();
		await expect.poll(() => readFile(filePath, "utf8")).toContain("| Qty | Note | Name |");

		await page.keyboard.press(`${undoModifier()}+z`);
		await expect(headerCells).toHaveText(["Name", "Qty", "Note"]);
		await expect.poll(() => readFile(filePath, "utf8")).toContain("| Name | Qty | Note |");
	} finally {
		await fixture.dispose();
	}
});

test("row grip reorder is undone by one Mod-z", async () => {
	const fixture = await openTableFixture();
	try {
		const { page, editor, filePath } = fixture;
		const rows = editor.locator("table tbody tr:not(:first-child)");
		await expect(rows).toHaveCount(2);
		await rows.nth(0).locator("td").first().click();
		await expect(editor).toBeFocused();
		await dragGripToCell(
			page,
			rows.nth(0).locator("td").first(),
			rows.nth(1).locator("td").first(),
			"row",
		);
		await expect(rows.nth(0).locator("td")).toHaveText(["pear", "5", "green"]);
		await expect(editor).toBeFocused();
		await expect.poll(() => readFile(filePath, "utf8")).toContain("| pear | 5 | green |");

		await page.keyboard.press(`${undoModifier()}+z`);
		await expect(rows.nth(0).locator("td")).toHaveText(["apple", "3", "ripe"]);
		await expect.poll(() => readFile(filePath, "utf8")).toContain("| apple | 3 | ripe |");
	} finally {
		await fixture.dispose();
	}
});

async function openTableFixture() {
	const workspaceDir = await mkdtemp(path.join(tmpdir(), "flashtype-table-reorder-"));
	const userDataDir = await mkdtemp(path.join(tmpdir(), "flashtype-table-profile-"));
	const filePath = path.join(workspaceDir, "table.md");
	await writeFile(filePath, initialMarkdown, "utf8");
	const app = await launchDevElectronApp(workspaceDir, { userDataDir });
	const page = await app.firstWindow();
	await ensureFilesViewOpenInLeftPanel(page);
	const file = fileTreeFile(page, "/table.md");
	await expect(file).toBeVisible();
	await file.click();
	await expect(file).toHaveAttribute("data-item-selected", "true");
	const editor = page.locator('[data-testid="tiptap-editor"] .ProseMirror');
	await expect(editor).toBeVisible();
	return {
		page,
		editor,
		filePath,
		async dispose() {
			await closeElectronApp(app);
			await rm(workspaceDir, { recursive: true, force: true });
			await rm(userDataDir, { recursive: true, force: true });
		},
	};
}

async function dragGripToCell(
	page: import("@playwright/test").Page,
	sourceCell: import("@playwright/test").Locator,
	targetCell: import("@playwright/test").Locator,
	axis: "row" | "column",
): Promise<void> {
	await sourceCell.hover();
	const grip = page.locator(`.markdown-table-grip[data-axis="${axis}"]`);
	await expect(grip).toBeVisible();
	const source = await grip.boundingBox();
	const target = await targetCell.boundingBox();
	if (!source || !target) throw new Error(`Could not measure the ${axis} drag targets.`);
	const targetX = target.x + target.width * (axis === "column" ? 0.8 : 0.5);
	const targetY = target.y + target.height * (axis === "row" ? 0.8 : 0.5);
	await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetX, targetY, { steps: 8 });
	await page.mouse.up();
}

function undoModifier(): "Meta" | "Control" {
	return process.platform === "darwin" ? "Meta" : "Control";
}
