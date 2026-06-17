import { describe, expect, test, vi } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	loadInstalledExtensionsFromLix,
	parseManifest,
} from "./installed-extension-loader";
import { installExtensionFromFiles } from "./extension-installation";

describe("parseManifest", () => {
	test("normalizes file extension handlers from extension manifests", () => {
		const manifest = parseManifest(
			"/.lix_system/app_data/flashtype/extensions/table-viewer/manifest.json",
			JSON.stringify({
				id: "table-viewer",
				name: "Table Viewer",
				entry: "./index.js",
				fileExtensions: [" .CSV ", ".TSV", ""],
			}),
		);

		expect(manifest.fileExtensions).toEqual(["csv", "tsv"]);
	});

	test("loads installed extensions from the extension storage root", async () => {
		const lix = await openLix();
		try {
			await installExtensionFromFiles(lix, {
				extensionId: "table-viewer",
				files: [
					{
						path: "manifest.json",
						data: JSON.stringify({
							id: "table-viewer",
							name: "Table Viewer",
							description: "Shows tables",
							entry: "./index.js",
							fileExtensions: ["csv"],
						}),
					},
					{
						path: "index.js",
						data: "export function render({ target }) { target.textContent = 'table'; }",
					},
				],
			});

			const render = vi.fn();
			const importModule = vi.fn(async () => ({ render }));
			const definitions = await loadInstalledExtensionsFromLix(lix, {
				importModule,
			});
			const tableViewer = definitions.find(
				(definition) => definition.kind === "table-viewer",
			);

			expect(tableViewer).toMatchObject({
				kind: "table-viewer",
				label: "Table Viewer",
				description: "Shows tables",
				fileExtensions: ["csv"],
			});
			expect(tableViewer?.render).toEqual(expect.any(Function));
			expect(importModule).toHaveBeenCalledWith(
				"export function render({ target }) { target.textContent = 'table'; }",
				"/.lix_system/app_data/flashtype/extensions/table-viewer/index.js",
			);
		} finally {
			await lix.close();
		}
	});
});
