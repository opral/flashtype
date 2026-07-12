import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createAgentTurnFileCapture } from "./agent-turn-file-capture.mjs";

describe("agent turn file capture", () => {
	test("baselines Markdown and returns only files touched during the turn", async () => {
		const workspacePath = await mkdtemp(
			path.join(tmpdir(), "flashtype-agent-turn-files-"),
		);
		try {
			await mkdir(path.join(workspacePath, "notes"), { recursive: true });
			await mkdir(path.join(workspacePath, ".git"), { recursive: true });
			await writeFile(
				path.join(workspacePath, "notes", "unopened.md"),
				"before\n",
			);
			await writeFile(
				path.join(workspacePath, "notes", "deleted.md"),
				"delete me\n",
			);
			await writeFile(
				path.join(workspacePath, "notes", "reference.txt"),
				"x\n",
			);
			await writeFile(path.join(workspacePath, ".git", "ignored.md"), "x\n");

			const capture = await createAgentTurnFileCapture(workspacePath);
			expect(capture.baselinePaths).toEqual([
				"notes/deleted.md",
				"notes/unopened.md",
			]);

			await writeFile(
				path.join(workspacePath, "notes", "unopened.md"),
				"after\n",
			);
			await writeFile(path.join(workspacePath, "created.md"), "new\n");
			await rm(path.join(workspacePath, "notes", "deleted.md"));
			await writeFile(
				path.join(workspacePath, ".git", "ignored.md"),
				"after\n",
			);

			expect(await capture.finish()).toEqual([
				"created.md",
				"notes/unopened.md",
				"notes/deleted.md",
			]);
		} finally {
			await rm(workspacePath, { recursive: true, force: true });
		}
	});
});
