import { describe, expect, test } from "vitest";
import { openLix, bundledPluginArchives, type Lix } from "@/test-utils/node-lix-sdk";
import { getExternalWriteReview } from "@/shell/external-write-review-history";
import {
	hashFileData,
	markFlashtypeFileWrite,
	consumeRecentFlashtypeFileWrite,
} from "@/extension-runtime/external-write-tracking";
import type { MarkdownBlockSnapshot } from "./review-diff";
import {
	renderMarkdownProjection,
	renderMarkdownProjectionText,
} from "./granular-review-projection";
import { planGranularReview } from "./granular-review-plan";

// These tests characterize the real bundled Lix Markdown plugin. They are the
// authoritative proof that `renderMarkdownProjection` reproduces the canonical
// `lix_file_history.data` that the granular review feature composes against. If
// any of these fail after a plugin bump, the projection contract changed and
// the planner must not be trusted until this file is updated.

type RealReview = {
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly beforeBlocks: MarkdownBlockSnapshot[];
	readonly afterBlocks: MarkdownBlockSnapshot[];
};

async function characterizeExternalWrite(
	beforeInput: Uint8Array | string,
	afterInput: Uint8Array | string,
): Promise<RealReview> {
	const lix = await openLix();
	try {
		await installBundledPlugins(lix);
		const path = "/fixtures/characterize.md";
		await writeFileBytes(lix, path, toBytes(beforeInput));
		const fileId = await fileIdByPath(lix, path);
		await writeFileBytes(lix, path, toBytes(afterInput));

		const review = await getExternalWriteReview(lix, fileId, path);
		if (!review) throw new Error("expected an external write review");
		const beforeBlocks = await historicalMarkdownBlocks(
			lix,
			review.beforeCommitId,
			fileId,
		);
		const afterBlocks = await historicalMarkdownBlocks(
			lix,
			review.afterCommitId,
			fileId,
		);
		return {
			beforeData: review.beforeData,
			afterData: review.afterData,
			beforeBlocks,
			afterBlocks,
		};
	} finally {
		await lix.close();
	}
}

describe("renderMarkdownProjection characterizes the Lix projection contract", () => {
	test("rendered before/after snapshots equal lix_file_history.data byte-for-byte", async () => {
		const review = await characterizeExternalWrite(
			"# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n",
			"# Plan\n\nFirst paragraph edited.\n\nSecond paragraph.\n\nThird paragraph.\n",
		);

		expect(review.beforeBlocks.length).toBeGreaterThan(0);
		expect(review.afterBlocks.length).toBeGreaterThan(0);
		expectBytesEqual(
			renderMarkdownProjection(review.beforeBlocks),
			review.beforeData,
		);
		expectBytesEqual(
			renderMarkdownProjection(review.afterBlocks),
			review.afterData,
		);
	});

	test("the projection joins blocks with one blank line and a single trailing newline", () => {
		const blocks: MarkdownBlockSnapshot[] = [
			{ id: "a", orderKey: "20", block: "# Title" },
			{ id: "b", orderKey: "40", block: "Body paragraph." },
		];
		expect(renderMarkdownProjectionText(blocks)).toBe(
			"# Title\n\nBody paragraph.\n",
		);
	});

	test("ordering follows order_key, not snapshot array order", () => {
		const blocks: MarkdownBlockSnapshot[] = [
			{ id: "b", orderKey: "40", block: "Second" },
			{ id: "a", orderKey: "20", block: "First" },
		];
		expect(renderMarkdownProjectionText(blocks)).toBe("First\n\nSecond\n");
	});

	test("CRLF input is canonicalized to LF in the projection", async () => {
		const review = await characterizeExternalWrite(
			"# Title\r\n\r\nWindows body.\r\n",
			"# Title\r\n\r\nWindows body edited.\r\n",
		);
		const afterText = new TextDecoder("utf-8", { fatal: true }).decode(
			review.afterData,
		);
		expect(afterText).not.toContain("\r");
		expectBytesEqual(
			renderMarkdownProjection(review.afterBlocks),
			review.afterData,
		);
	});

	test("a leading BOM is normalized away by Lix", async () => {
		const withBom = new Uint8Array([
			0xef,
			0xbb,
			0xbf,
			...new TextEncoder().encode("# Title\n\nBom body.\n"),
		]);
		const review = await characterizeExternalWrite(
			withBom,
			"# Title\n\nBom body changed.\n",
		);
		// The before projection must equal the canonical history bytes, proving we
		// never have to reproduce the raw BOM.
		expect(review.beforeData[0]).not.toBe(0xef);
		expectBytesEqual(
			renderMarkdownProjection(review.beforeBlocks),
			review.beforeData,
		);
	});

	test("extra blank separators collapse into the canonical projection", async () => {
		const review = await characterizeExternalWrite(
			"# Title\n\n\n\nSpaced body.\n",
			"# Title\n\n\n\nSpaced body edited.\n",
		);
		expectBytesEqual(
			renderMarkdownProjection(review.afterBlocks),
			review.afterData,
		);
		// No run of three or more newlines survives canonicalization.
		const afterText = new TextDecoder().decode(review.afterData);
		expect(afterText).not.toMatch(/\n{3,}/);
	});

	test("supported non-UTF-8 input is exposed as canonical UTF-8 projection", async () => {
		// 0xE9 is Latin-1 'é'. We do not assert the exact decoding the plugin
		// chooses; only that whatever it stores is valid UTF-8 and round-trips
		// through our projection renderer.
		const latin1 = new Uint8Array([
			...new TextEncoder().encode("# Caf"),
			0xe9,
			...new TextEncoder().encode("\n\nLatin body.\n"),
		]);
		const review = await characterizeExternalWrite(
			latin1,
			"# Cafe\n\nLatin body edited.\n",
		);
		expect(() =>
			new TextDecoder("utf-8", { fatal: true }).decode(review.beforeData),
		).not.toThrow();
		expectBytesEqual(
			renderMarkdownProjection(review.beforeBlocks),
			review.beforeData,
		);
	});

	test("writing a canonical projection back through lix_file.data round-trips exactly", async () => {
		const lix = await openLix();
		try {
			await installBundledPlugins(lix);
			const path = "/fixtures/roundtrip.md";
			await writeFileBytes(
				lix,
				path,
				toBytes("# Title\n\nOriginal body.\n"),
			);
			const fileId = await fileIdByPath(lix, path);
			await writeFileBytes(lix, path, toBytes("# Title\n\nUpdated body.\n"));

			const review = await getExternalWriteReview(lix, fileId, path);
			if (!review) throw new Error("expected review");
			const afterBlocks = await historicalMarkdownBlocks(
				lix,
				review.afterCommitId,
				fileId,
			);
			const canonical = renderMarkdownProjection(afterBlocks);

			await writeFileBytes(lix, path, canonical);
			const observed = await fileDataByPath(lix, path);
			expectBytesEqual(observed, canonical);
			expectBytesEqual(observed, review.afterData);
		} finally {
			await lix.close();
		}
	});

	test("an exact self-write hash from the canonical projection is consumed once", () => {
		const fileId = "self-write-file";
		const blocks: MarkdownBlockSnapshot[] = [
			{ id: "a", orderKey: "20", block: "# Title" },
			{ id: "b", orderKey: "40", block: "Body." },
		];
		const bytes = renderMarkdownProjection(blocks);
		const now = 1_000;
		markFlashtypeFileWrite(fileId, bytes, now);
		const hash = hashFileData(bytes);

		expect(consumeRecentFlashtypeFileWrite(fileId, "deadbeef", now)).toBe(false);
		expect(consumeRecentFlashtypeFileWrite(fileId, hash, now)).toBe(true);
		// Consumed exactly once.
		expect(consumeRecentFlashtypeFileWrite(fileId, hash, now)).toBe(false);
	});

	test("an edit that changes block boundaries surfaces as snapshot churn but still round-trips", async () => {
		// Splitting one paragraph into two changes block boundaries, so the Lix
		// plugin may assign fresh ids rather than report a single "modified" block.
		// The planner must not assume id stability; the projection contract still
		// holds regardless.
		const review = await characterizeExternalWrite(
			"# Title\n\nOne sentence. Another sentence in the same paragraph.\n",
			"# Title\n\nOne sentence.\n\nAnother sentence in the same paragraph.\n",
		);
		expectBytesEqual(
			renderMarkdownProjection(review.beforeBlocks),
			review.beforeData,
		);
		expectBytesEqual(
			renderMarkdownProjection(review.afterBlocks),
			review.afterData,
		);
		// The after side gained a block relative to before.
		expect(review.afterBlocks.length).toBeGreaterThan(
			review.beforeBlocks.length,
		);
	});
});

describe("extended Markdown falls back to classic review end-to-end", () => {
	test("a real footnote edit is kept off the granular path", async () => {
		const review = await characterizeExternalWrite(
			"# Doc\n\nA claim.[^1]\n\n[^1]: The original note.\n",
			"# Doc\n\nA claim.[^1]\n\n[^1]: The revised note.\n",
		);
		// The footnote syntax survives in the canonical projection bytes...
		expect(new TextDecoder().decode(review.afterData)).toContain("[^1]");
		// ...so the planner conservatively reports the extended-markdown fallback.
		expect(
			planGranularReview({
				beforeBlocks: review.beforeBlocks,
				afterBlocks: review.afterBlocks,
				beforeData: review.beforeData,
				afterData: review.afterData,
			}),
		).toMatchObject({ status: "unsafe", reason: "extended_markdown" });
	});

	test("a real inline-math edit is kept off the granular path", async () => {
		const review = await characterizeExternalWrite(
			"# Doc\n\nEnergy is $E = mc^2$ exactly.\n",
			"# Doc\n\nEnergy is $E = mc^2$ precisely.\n",
		);
		expect(new TextDecoder().decode(review.afterData)).toContain("$E = mc^2$");
		expect(
			planGranularReview({
				beforeBlocks: review.beforeBlocks,
				afterBlocks: review.afterBlocks,
				beforeData: review.beforeData,
				afterData: review.afterData,
			}),
		).toMatchObject({ status: "unsafe", reason: "extended_markdown" });
	});
});

function toBytes(input: Uint8Array | string): Uint8Array {
	return typeof input === "string" ? new TextEncoder().encode(input) : input;
}

function expectBytesEqual(actual: Uint8Array, expected: Uint8Array): void {
	expect(Array.from(actual)).toEqual(Array.from(expected));
}

async function writeFileBytes(
	lix: Lix,
	path: string,
	data: Uint8Array,
): Promise<void> {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES (?, ?) \
		 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[path, data],
	);
}

async function installBundledPlugins(lix: Lix): Promise<void> {
	for (const plugin of await bundledPluginArchives()) {
		await lix.execute(
			"INSERT INTO lix_file (path, data) VALUES (?, ?) \
			 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
			[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
		);
	}
}

async function fileIdByPath(lix: Lix, path: string): Promise<string> {
	const result = await lix.execute("SELECT id FROM lix_file WHERE path = ?", [
		path,
	]);
	const id = result.rows[0]?.get("id");
	if (typeof id !== "string") throw new Error(`Missing file id for ${path}`);
	return id;
}

async function fileDataByPath(lix: Lix, path: string): Promise<Uint8Array> {
	const result = await lix.execute(
		"SELECT data FROM lix_file WHERE path = ?",
		[path],
	);
	const { decodeFileDataToBytes } = await import("@/lib/decode-file-data");
	return decodeFileDataToBytes(result.rows[0]?.get("data"));
}

async function historicalMarkdownBlocks(
	lix: Lix,
	commitId: string | undefined,
	fileId: string,
): Promise<MarkdownBlockSnapshot[]> {
	if (!commitId) throw new Error("missing commit id for block history");
	const result = await lix.execute(
		`
			WITH ranked AS (
				SELECT
					snapshot_content,
					ROW_NUMBER() OVER (
						PARTITION BY entity_pk
						ORDER BY depth ASC
					) AS rn
				FROM lix_state_history
				WHERE start_commit_id = ?
					AND file_id = ?
					AND schema_key = 'markdown_block'
			)
			SELECT snapshot_content
			FROM ranked
			WHERE rn = 1
				AND snapshot_content IS NOT NULL
		`,
		[commitId, fileId],
	);
	return result.rows
		.map((row) => parseSnapshot(row.get("snapshot_content")))
		.filter((block): block is MarkdownBlockSnapshot => block !== null);
}

function parseSnapshot(value: unknown): MarkdownBlockSnapshot | null {
	const content =
		typeof value === "string"
			? JSON.parse(value)
			: (value as Record<string, unknown> | null);
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
	};
}
