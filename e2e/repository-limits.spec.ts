import { expect, test } from "@playwright/test";
import {
	mkdtemp,
	open,
	readdir,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchDevElectronApp } from "./electron-test-utils";

test("oversized folders remain editable and initialization is blocked through IPC and History", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-limit-e2e-"));
	const userDataDir = await mkdtemp(
		path.join(tmpdir(), "flashtype-limit-profile-"),
	);
	await Promise.all(
		Array.from({ length: 201 }, (_, i) =>
			writeFile(path.join(root, `note-${i}.md`), `# Note ${i}\n`),
		),
	);
	const oversized = await open(path.join(root, "large.bin"), "w");
	await oversized.truncate(1_000_000_001);
	await oversized.close();
	const app = await launchDevElectronApp(root, { userDataDir });
	try {
		const page = await app.firstWindow();
		await expect(
			page.getByRole("button", {
				name: /Open checkpoint history|Review working changes/,
			}),
		).toBeVisible({ timeout: 30_000 });
		await page
			.locator('[data-area-side="right"] [data-attr="panel-section-picker"]')
			.click();
		await page.getByRole("menuitem", { name: "History", exact: true }).click();

		const history = page
			.getByTestId(/atelier-view:.*history/)
			.filter({ visible: true })
			.first();
		await expect(
			history.getByText(/This folder exceeds the repository limit/),
		).toBeVisible();
		await expect(
			history.getByRole("button", {
				name: "Initialize repository",
				exact: true,
			}),
		).toBeDisabled();
		const message = await page.evaluate(async () => {
			try {
				await window.flashtypeDesktop!.workspace.initializeRepository();
				return "unexpected success";
			} catch (error) {
				return String(error);
			}
		});
		expect(message).toContain("exceeds the 1 GB");
		expect(await readdir(root)).not.toContain(".lix");
		expect(
			await page.evaluate(() => window.flashtypeDesktop!.workspace.get()),
		).toMatchObject({ ephemeral: true });
		await page.screenshot({ path: "/tmp/flashtype-repository-limit-ui.png" });
		await unlink(path.join(root, "large.bin"));
		await history.getByRole("button", { name: "Check again" }).click();
		await expect(
			history.getByRole("button", {
				name: "Initialize repository",
				exact: true,
			}),
		).toBeEnabled();
		await history
			.getByRole("button", { name: "Initialize repository", exact: true })
			.click();
		await expect
			.poll(async () =>
				page.evaluate(() => window.flashtypeDesktop!.workspace.get()),
			)
			.toMatchObject({ ephemeral: false });
		await expect.poll(() => readdir(root)).toContain(".lix");
	} finally {
		await app.close();
		await rm(root, { recursive: true, force: true });
		await rm(userDataDir, { recursive: true, force: true });
	}
});
