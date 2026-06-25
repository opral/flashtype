import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	openLix,
	createFsBackend,
	bundledPluginArchives,
	type Lix,
} from "@/test-utils/node-lix-sdk";
import { getExternalWriteReview } from "@/shell/external-write-review-history";
import { planGranularReview } from "@/extensions/markdown/granular-review-plan";
import type { MarkdownBlockSnapshot } from "@/extensions/markdown/review-diff";
import { ensureMarkdownReviewBaseline } from "./markdown-review-baseline";

// These tests reproduce the real desktop ingest path with a filesystem-backed
// Lix: a file scanned from disk at boot is untracked, so without a baseline the
// first external write has no real before-commit and granular review is not
// available. `ensureMarkdownReviewBaseline` closes that gap.

const ORIGINAL = "# Review\n\nAlpha.\n\nBeta.\n";
const EXTERNAL = "# Review\n\nAlpha edited.\n\nBeta.\n";
const enc = (s: string) => new TextEncoder().encode(s);

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

// Boot a real filesystem-backed Lix with a markdown file already on disk. The
// scan-in ingests it as an untracked commit that carries NO `markdown_block`
// snapshots — exactly the desktop boot state the baseline must repair.
async function bootWorkspace(): Promise<{
	lix: Lix;
	fileId: string;
	mdPath: string;
}> {
	const dir = await mkdtemp(path.join(tmpdir(), "md-baseline-"));
	tempDirs.push(dir);
	const mdPath = path.join(dir, "review.md");
	await writeFile(mdPath, ORIGINAL);

	const lix = await openLix({
		backend: await createFsBackend({ path: dir, storage: "persistent" }),
	});
	for (const plugin of await bundledPluginArchives()) {
		await lix.execute(
			"INSERT INTO lix_file (path, data) VALUES (?, ?) ON CONFLICT (path) DO UPDATE SET data = excluded.data",
			[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
		);
	}
	await waitFor(async () => (await fileIdByPath(lix, "/review.md")) !== null);
	const fileId = (await fileIdByPath(lix, "/review.md"))!;
	return { lix, fileId, mdPath };
}

// Simulate an external write landing through the same ingest path the desktop
// watcher uses (a write to `lix_file.data`).
async function externalWrite(lix: Lix, fileId: string, markdown: string) {
	await lix.execute("UPDATE lix_file SET data = ? WHERE id = ?", [
		enc(markdown),
		fileId,
	]);
}

async function eligibilityOnFirstExternalWrite(lix: Lix, fileId: string) {
	const review = await getExternalWriteReview(lix, fileId, "/review.md");
	if (!review) throw new Error("expected a review");
	const beforeBlocks = await blocksAt(lix, review.beforeCommitId, fileId);
	const afterBlocks = await blocksAt(lix, review.afterCommitId, fileId);
	return planGranularReview({
		beforeBlocks,
		afterBlocks,
		beforeData: review.beforeData,
		afterData: review.afterData,
	});
}

describe("ensureMarkdownReviewBaseline", () => {
	test("without a baseline, the boot commit has no block snapshots so the first external write is not granular", async () => {
		const { lix, fileId } = await bootWorkspace();
		try {
			await externalWrite(lix, fileId, EXTERNAL);
			// The before-side is the boot commit, which carries zero markdown_block
			// snapshots, so its projection cannot reproduce the bytes -> classic.
			expect(
				(await eligibilityOnFirstExternalWrite(lix, fileId)).status,
			).toBe("unsafe");
		} finally {
			await lix.close();
		}
	});

	test("a baseline makes the first external write granular-eligible without touching disk", async () => {
		const { lix, fileId, mdPath } = await bootWorkspace();
		try {
			await ensureMarkdownReviewBaseline(lix, fileId);
			// The baseline writes identical bytes, so the on-disk file is untouched.
			expect(await readFile(mdPath, "utf8")).toBe(ORIGINAL);

			await externalWrite(lix, fileId, EXTERNAL);
			const review = await getExternalWriteReview(lix, fileId, "/review.md");
			expect(review).not.toBeNull();
			// The baseline gave the before-side a real commit with block snapshots...
			expect(typeof review!.beforeCommitId).toBe("string");
			// ...so the planner offers granular review on the very first edit.
			expect(
				(await eligibilityOnFirstExternalWrite(lix, fileId)).status,
			).toBe("safe");
		} finally {
			await lix.close();
		}
	});

	test("is idempotent: a second baseline call does not throw or change disk", async () => {
		const { lix, fileId, mdPath } = await bootWorkspace();
		try {
			await ensureMarkdownReviewBaseline(lix, fileId);
			await ensureMarkdownReviewBaseline(lix, fileId);
			expect(await readFile(mdPath, "utf8")).toBe(ORIGINAL);
			// Still granular after a redundant baseline.
			await externalWrite(lix, fileId, EXTERNAL);
			expect(
				(await eligibilityOnFirstExternalWrite(lix, fileId)).status,
			).toBe("safe");
		} finally {
			await lix.close();
		}
	});
});

async function fileIdByPath(lix: Lix, path: string): Promise<string | null> {
	const result = await lix.execute("SELECT id FROM lix_file WHERE path = ?", [
		path,
	]);
	const id = result.rows[0]?.get("id");
	return typeof id === "string" ? id : null;
}

async function blocksAt(
	lix: Lix,
	commitId: string | undefined,
	fileId: string,
): Promise<MarkdownBlockSnapshot[]> {
	if (!commitId) throw new Error("missing commit id");
	const result = await lix.execute(
		`WITH ranked AS (
			SELECT entity_pk, snapshot_content,
				ROW_NUMBER() OVER (PARTITION BY entity_pk ORDER BY depth ASC) AS rn
			FROM lix_state_history
			WHERE start_commit_id = ? AND file_id = ? AND schema_key = 'markdown_block'
		)
		SELECT snapshot_content FROM ranked WHERE rn = 1 AND snapshot_content IS NOT NULL`,
		[commitId, fileId],
	);
	return result.rows
		.map((row) => {
			const value = row.get("snapshot_content");
			const content = typeof value === "string" ? JSON.parse(value) : value;
			if (
				!content ||
				typeof content.id !== "string" ||
				typeof content.order_key !== "string" ||
				typeof content.block !== "string"
			) {
				return null;
			}
			return {
				id: content.id,
				orderKey: content.order_key,
				block: content.block,
			} satisfies MarkdownBlockSnapshot;
		})
		.filter((block): block is MarkdownBlockSnapshot => block !== null);
}

async function waitFor(
	predicate: () => Promise<boolean>,
	timeoutMs = 5000,
): Promise<void> {
	const start = Date.now();
	for (;;) {
		if (await predicate()) return;
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}
