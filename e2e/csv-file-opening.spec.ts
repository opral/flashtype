import { expect, test } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchDevElectronAppWithArgs } from "./electron-test-utils";

for (const source of ["launch argument", "macOS open-file event"] as const) {
	test(`opens CSV through the standard ${source} flow`, async () => {
		const root = await mkdtemp(path.join(tmpdir(), "flashtype-csv-open-"));
		const userDataDir = await mkdtemp(
			path.join(tmpdir(), "flashtype-csv-profile-"),
		);
		const csv = path.join(root, "table.csv");
		await writeFile(csv, "name,value\nAlpha,42\n");
		const app = await launchDevElectronAppWithArgs(
			source === "launch argument" ? [csv] : [],
			{ userDataDir },
		);
		try {
			const first = await app.firstWindow();
			await first.waitForFunction(() => Boolean(window.flashtypeDesktop));
			if (source === "macOS open-file event") {
				await app.evaluate(({ app }, file) => {
					app.emit("open-file", { preventDefault() {} }, file);
				}, csv);
			}
			await expect
				.poll(
					async () => {
						for (const page of app.windows())
							if (await page.locator(".csv-view[data-document]").isVisible()) return true;
						return false;
					},
					{ timeout: 30_000 },
				)
				.toBe(true);
			const page = app.windows().find((page) => !page.isClosed());
			expect(page).toBeDefined();
		} finally {
			await app.close();
			await rm(root, { recursive: true, force: true });
			await rm(userDataDir, { recursive: true, force: true });
		}
	});
}
