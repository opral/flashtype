import { describe, expect, test } from "vitest";
import { markdownPluginV2ArchiveBytes } from "@/test-utils/plugin-md-v2-archive";
import { openLix } from "@lix-js/sdk";
import { selectCheckpoints } from "@/queries";
import { selectCheckpointFiles } from "./queries";
import { qb } from "@lix-js/kysely";

describe("selectCheckpointFiles", () => {
	test("returns Markdown file summaries for a checkpoint", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
		const encoder = new TextEncoder();
		const fileId = "commit_view_file";
		const filePath = "/docs/commit-view.md";

		await qb(lix)
			.insertInto("lix_file")
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
			.updateTable("lix_file")
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
