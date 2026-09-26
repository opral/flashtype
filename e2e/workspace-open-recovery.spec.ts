import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	clickAndWaitForAppClose,
	launchDevElectronApp,
} from "./electron-test-utils";

test("a stalled repository open offers deletion and recovers on restart", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-timeout-e2e-"));
	const userDataDir = await mkdtemp(
		path.join(tmpdir(), "flashtype-timeout-profile-"),
	);
	await writeFile(path.join(root, "notes.md"), "# Keep this file\n");
	let app = await launchDevElectronApp(root, {
		userDataDir,
		env: { FLASHTYPE_DEV_SUPERVISED: "1" },
	});
	try {
		let page = await app.firstWindow();
		await expect(
			page.getByRole("button", {
				name: /Open checkpoint history|Review working changes/,
			}),
		).toBeVisible({ timeout: 30_000 });
		await page.evaluate(() =>
			window.flashtypeDesktop!.workspace.initializeRepository(),
		);
		await expect.poll(() => readdir(root)).toContain(".lix");
		// Simulate an open that never returns without touching the native engine.
		await app.evaluate(({ ipcMain }) => {
			ipcMain.removeHandler("lix:open");
			ipcMain.handle("lix:open", () => new Promise(() => {}));
		});
		await page.clock.install();
		await page.reload();
		await expect(page.getByRole("heading", { name: /Opening/ })).toBeVisible();
		await page.clock.fastForward(30_000);
		const button = page.getByRole("button", {
			name: "Delete .lix and restart",
		});
		await expect(button).toBeVisible();
		await page.screenshot({ path: "/tmp/flashtype-opening-timeout.png" });
		const shutdownErrors = path.join(userDataDir, "shutdown-errors.txt");
		await app.evaluate(({ dialog }, errorPath) => {
			const fs = process.getBuiltinModule("fs");
			const record = (error: unknown) =>
				fs.appendFileSync(errorPath, String(error) + "\n");
			process.on("uncaughtException", record);
			process.on("unhandledRejection", record);
			dialog.showErrorBox = (title, content) => record(title + ": " + content);
		}, shutdownErrors);
		await clickAndWaitForAppClose(app, button);
		expect(
			await readFile(shutdownErrors, "utf8").catch((error) => {
				if (error.code === "ENOENT") return "";
				throw error;
			}),
		).toBe("");
		// The dev supervisor normally relaunches this; do it explicitly for the test.
		expect(await readdir(root)).toContain(".lix");
		app = await launchDevElectronApp(root, { userDataDir });
		page = await app.firstWindow();
		await expect(
			page.getByRole("button", {
				name: /Open checkpoint history|Review working changes/,
			}),
		).toBeVisible({ timeout: 30_000 });
		expect(await readdir(root)).not.toContain(".lix");
		expect(await readFile(path.join(root, "notes.md"), "utf8")).toBe(
			"# Keep this file\n",
		);
		expect(
			await page.evaluate(() => window.flashtypeDesktop!.workspace.get()),
		).toMatchObject({ ephemeral: true });
	} finally {
		await app.close().catch(() => {});
		await rm(root, { recursive: true, force: true });
		await rm(userDataDir, { recursive: true, force: true });
	}
});

test("a previous native crash opens recovery without touching the damaged repository", async () => {
	const { mkdir } = await import("node:fs/promises");
	const root = await mkdtemp(path.join(tmpdir(), "flashtype-crash-e2e-"));
	const userDataDir = await mkdtemp(
		path.join(tmpdir(), "flashtype-crash-profile-"),
	);
	await mkdir(path.join(root, ".lix", ".internal", "rocksdb"), {
		recursive: true,
	});
	await writeFile(
		path.join(root, ".lix", "damaged-data"),
		"must not be opened",
	);
	await writeFile(path.join(root, "keep.md"), "keep");
	await writeFile(
		path.join(userDataDir, "workspace-pending-lix-open.json"),
		JSON.stringify({
			version: 1,
			recoveries: [{ workspacePath: root, reason: "lix_open_pending" }],
		}),
	);
	let app = await launchDevElectronApp(root, {
		userDataDir,
		env: { FLASHTYPE_DEV_SUPERVISED: "1" },
	});
	try {
		let page = await app.firstWindow();
		await expect(
			page.getByRole("heading", { name: "Track Changes could not be opened" }),
		).toBeVisible();
		// Even bypassing the renderer recovery gate cannot trigger native opening.
		const rejected = await page.evaluate(async () => {
			try {
				await window.flashtypeDesktop!.lix.open();
				return "opened";
			} catch (error) {
				return String(error);
			}
		});
		expect(rejected).toContain("needs recovery");
		expect(
			await readFile(path.join(root, ".lix", "damaged-data"), "utf8"),
		).toBe("must not be opened");
		const shutdownErrors = path.join(userDataDir, "shutdown-errors.txt");
		await app.evaluate(({ dialog }, errorPath) => {
			const fs = process.getBuiltinModule("fs");
			const record = (error: unknown) =>
				fs.appendFileSync(errorPath, String(error) + "\n");
			process.on("uncaughtException", record);
			process.on("unhandledRejection", record);
			dialog.showErrorBox = (title, content) => record(title + ": " + content);
		}, shutdownErrors);
		await clickAndWaitForAppClose(
			app,
			page.getByRole("button", { name: "Delete .lix and restart" }),
		);
		expect(
			await readFile(shutdownErrors, "utf8").catch((error) => {
				if (error.code === "ENOENT") return "";
				throw error;
			}),
		).toBe("");
		app = await launchDevElectronApp(root, { userDataDir });
		page = await app.firstWindow();
		await expect(
			page.getByRole("button", {
				name: /Open checkpoint history|Review working changes/,
			}),
		).toBeVisible({ timeout: 30_000 });
		expect(await readdir(root)).not.toContain(".lix");
		expect(await readFile(path.join(root, "keep.md"), "utf8")).toBe("keep");
	} finally {
		await app.close().catch(() => {});
		await rm(root, { recursive: true, force: true });
		await rm(userDataDir, { recursive: true, force: true });
	}
});
