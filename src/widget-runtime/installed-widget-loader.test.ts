import { describe, expect, test } from "vitest";
import { parseManifest } from "./installed-widget-loader";

describe("parseManifest", () => {
	test("normalizes file extension handlers from widget manifests", () => {
		const manifest = parseManifest(
			"/.lix_system/app_data/flashtype/widgets/table-viewer/manifest.json",
			JSON.stringify({
				id: "table-viewer",
				name: "Table Viewer",
				entry: "./index.js",
				fileExtensions: [" .CSV ", ".TSV", ""],
			}),
		);

		expect(manifest.fileExtensions).toEqual(["csv", "tsv"]);
	});
});
