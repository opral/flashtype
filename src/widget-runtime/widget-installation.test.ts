import { describe, expect, test, vi } from "vitest";
import type { Lix, SqlTransaction } from "@/lib/lix-types";
import { installWidgetFromFiles, uninstallWidget } from "./widget-installation";

const encoder = new TextEncoder();

function createMockLix() {
	const txExecute = vi.fn(async () => ({ rows: [], columns: [] }));
	const tx = {
		execute: txExecute,
		commit: vi.fn(async () => {}),
		rollback: vi.fn(async () => {}),
	} as unknown as SqlTransaction;

	const transaction = vi.fn(
		async (cb: (tx: SqlTransaction) => Promise<unknown>) => cb(tx),
	);

	const lix = {
		transaction,
	} as unknown as Lix;

	return { lix, transaction, txExecute };
}

describe("widget installation", () => {
	test("installs widget files into global branch", async () => {
		const { lix, txExecute } = createMockLix();

		await installWidgetFromFiles(lix, {
			widgetId: "conversation",
			files: [
				{
					path: "manifest.json",
					data: '{"id":"conversation","name":"Conversation","entry":"./index.js"}',
				},
				{
					path: "index.js",
					data: "export function render({ target }) { target.textContent = 'ok'; }",
				},
			],
		});

		expect(txExecute).toHaveBeenCalledTimes(4);
		expect(txExecute).toHaveBeenNthCalledWith(
			1,
			"DELETE FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path = ?",
			[
				"global",
				"/.lix_system/app_data/flashtype/widgets/conversation/manifest.json",
			],
		);
		expect(txExecute).toHaveBeenNthCalledWith(
			2,
			"INSERT INTO lix_file_by_branch (path, data, lixcol_branch_id, lixcol_global) VALUES (?, ?, ?, ?)",
			[
				"/.lix_system/app_data/flashtype/widgets/conversation/manifest.json",
				encoder.encode(
					'{"id":"conversation","name":"Conversation","entry":"./index.js"}',
				),
				"global",
				true,
			],
		);
		expect(txExecute).toHaveBeenNthCalledWith(
			3,
			"DELETE FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path = ?",
			[
				"global",
				"/.lix_system/app_data/flashtype/widgets/conversation/index.js",
			],
		);
		expect(txExecute).toHaveBeenNthCalledWith(
			4,
			"INSERT INTO lix_file_by_branch (path, data, lixcol_branch_id, lixcol_global) VALUES (?, ?, ?, ?)",
			[
				"/.lix_system/app_data/flashtype/widgets/conversation/index.js",
				encoder.encode(
					"export function render({ target }) { target.textContent = 'ok'; }",
				),
				"global",
				true,
			],
		);
	});

	test("uninstalls widget files and root directory from global branch", async () => {
		const { lix, txExecute } = createMockLix();

		await uninstallWidget(lix, "conversation");

		expect(txExecute).toHaveBeenCalledTimes(2);
		expect(txExecute).toHaveBeenNthCalledWith(
			1,
			"DELETE FROM lix_file_by_branch WHERE lixcol_branch_id = ? AND path LIKE ?",
			["global", "/.lix_system/app_data/flashtype/widgets/conversation/%"],
		);
		expect(txExecute).toHaveBeenNthCalledWith(
			2,
			"DELETE FROM lix_directory_by_branch WHERE lixcol_branch_id = ? AND path = ?",
			["global", "/.lix_system/app_data/flashtype/widgets/conversation/"],
		);
	});

	test("rejects path traversal in install file paths", async () => {
		const { lix } = createMockLix();
		await expect(
			installWidgetFromFiles(lix, {
				widgetId: "conversation",
				files: [{ path: "../escape.js", data: "export const x = 1;" }],
			}),
		).rejects.toThrow("must not contain '.' or '..' segments");
	});
});
