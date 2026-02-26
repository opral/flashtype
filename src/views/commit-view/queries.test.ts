import { describe, expect, test } from "vitest";
import { openLix } from "@lix-js/sdk";
import { selectCheckpoints } from "@/queries";
import { selectCheckpointFiles } from "./queries";
import markdownPluginV2Manifest from "../../../lix/packages/plugin-md-v2/manifest.json";
import markdownPluginV2WasmRaw from "../../../lix/target/wasm32-wasip2/release/plugin_md_v2.wasm?raw";
import { qb } from "@lix-js/kysely";

const markdownPluginV2WasmBytes = Uint8Array.from(
	markdownPluginV2WasmRaw,
	(char) => char.charCodeAt(0),
);

describe("selectCheckpointFiles", () => {
	test("returns Markdown file summaries for a checkpoint", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			manifestJson: markdownPluginV2Manifest,
			wasmBytes: markdownPluginV2WasmBytes,
		});
		const encoder = new TextEncoder();
		const fileId = "commit_view_file";
		const filePath = "/docs/commit-view.md";

		await qb(lix)
			.insertInto("file")
			.values({
				id: fileId,
				path: filePath,
				data: encoder.encode("# Title\n\nInitial content.\n"),
			})
			.execute();

		// Baseline checkpoint for initial state
		await lix.createCheckpoint();

		// Modify the file to generate Markdown entity changes
		await qb(lix)
			.updateTable("file")
			.set({
				data: encoder.encode("# Title\n\nInitial content.\n\nNew paragraph."),
			})
			.where("id", "=", fileId)
			.execute();

		// Capture the change in a new checkpoint
		await lix.createCheckpoint();

		const checkpoints = await selectCheckpoints({ lix }).execute();
		expect(checkpoints.length).toBeGreaterThan(0);
		const latest = checkpoints[0]!;

		const rows = await selectCheckpointFiles({
			lix,
			changeSetId: latest.id,
		}).execute();

		expect(rows).toHaveLength(1);
		const [row] = rows;
		expect(row.file_id).toBe(fileId);
		expect(row.path).toBe(filePath);
		expect((row.added ?? 0) + (row.removed ?? 0)).toBeGreaterThan(0);
	});
});
