import { describe, expect, test } from "vitest";
import {
	openLix,
	bundledPluginArchives,
	type Lix,
} from "@/test-utils/node-lix-sdk";
import type { GranularReviewResolution } from "@/extension-runtime/external-write-review";
import {
	applyGranularReviewResolution,
	granularResolutionTelemetry,
} from "./external-write-review-resolution";

const enc = (text: string) => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

type Fixture = {
	readonly lix: Lix;
	readonly fileId: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
};

async function openReviewFixture(): Promise<Fixture> {
	const lix = await openLix();
	await installBundledPlugins(lix);
	const path = "/fixtures/resolution.md";
	const beforeData = enc("# Title\n\nAlpha.\n\nBeta.\n");
	const afterData = enc("# Title\n\nAlpha edited.\n\nBeta edited.\n");
	await writeFile(lix, path, dec(beforeData));
	const fileId = await fileIdByPath(lix, path);
	// Bring the file to the review's after-state, as an agent write would, so the
	// resolution's stale compare-and-write runs against the after-state.
	await writeFile(lix, path, dec(afterData));
	return { lix, fileId, beforeData, afterData };
}

function resolution(
	fixture: Fixture,
	overrides: Partial<GranularReviewResolution> & {
		resolvedData: Uint8Array;
		acceptedCount: number;
		rejectedCount: number;
	},
): GranularReviewResolution {
	return {
		fileId: fixture.fileId,
		reviewId: "review-1",
		afterData: fixture.afterData,
		beforeData: fixture.beforeData,
		usedRemainingAction: false,
		...overrides,
	};
}

describe("applyGranularReviewResolution", () => {
	test("writes once when current data still matches the review after-state", async () => {
		const fixture = await openReviewFixture();
		try {
			const resolvedData = enc("# Title\n\nAlpha edited.\n\nBeta.\n");
			const result = await applyGranularReviewResolution(
				fixture.lix,
				resolution(fixture, {
					resolvedData,
					acceptedCount: 1,
					rejectedCount: 1,
				}),
			);
			expect(result.outcome).toBe("applied");
			const observed = await fileData(fixture.lix, fixture.fileId);
			expect(dec(observed)).toBe("# Title\n\nAlpha edited.\n\nBeta.\n");
		} finally {
			await fixture.lix.close();
		}
	});

	test("does not write when the file changed since the review opened", async () => {
		const fixture = await openReviewFixture();
		try {
			// A newer external write lands before the user resolves.
			await writeFile(
				fixture.lix,
				"/fixtures/resolution.md",
				"# Title\n\nSomething else entirely.\n",
			);
			const resolvedData = enc("# Title\n\nAlpha edited.\n\nBeta.\n");
			const result = await applyGranularReviewResolution(
				fixture.lix,
				resolution(fixture, {
					resolvedData,
					acceptedCount: 1,
					rejectedCount: 1,
				}),
			);
			expect(result.outcome).toBe("stale");
			const observed = await fileData(fixture.lix, fixture.fileId);
			expect(dec(observed)).toBe("# Title\n\nSomething else entirely.\n");
		} finally {
			await fixture.lix.close();
		}
	});

	test("all accepted performs no write and reports accepted_existing", async () => {
		const fixture = await openReviewFixture();
		try {
			const result = await applyGranularReviewResolution(
				fixture.lix,
				resolution(fixture, {
					resolvedData: fixture.afterData,
					acceptedCount: 2,
					rejectedCount: 0,
				}),
			);
			expect(result.outcome).toBe("accepted_existing");
			const observed = await fileData(fixture.lix, fixture.fileId);
			expect(dec(observed)).toBe(dec(fixture.afterData));
		} finally {
			await fixture.lix.close();
		}
	});

	test("all accepted reports stale when the file changed after the review opened", async () => {
		const fixture = await openReviewFixture();
		try {
			// A newer external write lands after the review opened but before the
			// user accepts every change.
			await writeFile(
				fixture.lix,
				"/fixtures/resolution.md",
				"# Title\n\nSomething else entirely.\n",
			);
			const result = await applyGranularReviewResolution(
				fixture.lix,
				resolution(fixture, {
					resolvedData: fixture.afterData,
					acceptedCount: 2,
					rejectedCount: 0,
				}),
			);
			expect(result.outcome).toBe("stale");
			// The newer write is preserved untouched — the review is not applied.
			const observed = await fileData(fixture.lix, fixture.fileId);
			expect(dec(observed)).toBe("# Title\n\nSomething else entirely.\n");
		} finally {
			await fixture.lix.close();
		}
	});

	test("all accepted reports missing when the file no longer exists", async () => {
		const fixture = await openReviewFixture();
		try {
			const result = await applyGranularReviewResolution(fixture.lix, {
				...resolution(fixture, {
					resolvedData: fixture.afterData,
					acceptedCount: 2,
					rejectedCount: 0,
				}),
				fileId: "does-not-exist",
			});
			expect(result.outcome).toBe("missing");
		} finally {
			await fixture.lix.close();
		}
	});

	test("all rejected writes the exact before-state", async () => {
		const fixture = await openReviewFixture();
		try {
			const result = await applyGranularReviewResolution(
				fixture.lix,
				resolution(fixture, {
					resolvedData: fixture.beforeData,
					acceptedCount: 0,
					rejectedCount: 2,
				}),
			);
			expect(result.outcome).toBe("applied");
			const observed = await fileData(fixture.lix, fixture.fileId);
			expect(dec(observed)).toBe(dec(fixture.beforeData));
		} finally {
			await fixture.lix.close();
		}
	});

	test("a missing file reports missing", async () => {
		const fixture = await openReviewFixture();
		try {
			const result = await applyGranularReviewResolution(fixture.lix, {
				...resolution(fixture, {
					resolvedData: enc("x\n"),
					acceptedCount: 1,
					rejectedCount: 1,
				}),
				fileId: "does-not-exist",
			});
			expect(result.outcome).toBe("missing");
		} finally {
			await fixture.lix.close();
		}
	});

	test("telemetry properties are aggregate and content-free", () => {
		const props = granularResolutionTelemetry({
			acceptedCount: 2,
			rejectedCount: 1,
			usedRemainingAction: true,
		});
		expect(props).toEqual({
			review_mode: "granular",
			change_count: 3,
			accepted_count: 2,
			rejected_count: 1,
			used_remaining_action: true,
		});
		// Only aggregate keys are present — no fileId, reviewId, block/change ids,
		// order keys, hashes, paths, or content.
		expect(Object.keys(props).sort()).toEqual([
			"accepted_count",
			"change_count",
			"rejected_count",
			"review_mode",
			"used_remaining_action",
		]);
		expect(Object.values(props).every((v) => typeof v !== "object")).toBe(true);
	});

	test("a failed transaction reports failed and writes nothing", async () => {
		const fileId = "failing-file";
		const resolvedData = enc("# Title\n\nMixed.\n");
		const afterData = enc("# Title\n\nAfter.\n");
		// Fake lix whose UPDATE throws so the resolution cannot be persisted.
		const fakeLix = {
			async transaction<T>(
				callback: (tx: {
					execute: (
						sql: string,
						params?: ReadonlyArray<unknown>,
					) => Promise<any>;
				}) => Promise<T>,
			): Promise<T> {
				return callback({
					execute: async (sql: string) => {
						if (sql.startsWith("SELECT")) {
							return { rows: [{ get: () => afterData }] };
						}
						throw new Error("simulated write failure");
					},
				});
			},
		} as unknown as Lix;

		const result = await applyGranularReviewResolution(fakeLix, {
			fileId,
			reviewId: "review-1",
			resolvedData,
			afterData,
			beforeData: enc("# Title\n\nBefore.\n"),
			acceptedCount: 1,
			rejectedCount: 1,
			usedRemainingAction: false,
		});
		expect(result.outcome).toBe("failed");
	});
});

async function writeFile(
	lix: Lix,
	path: string,
	markdown: string,
): Promise<void> {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES (?, ?) \
		 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[path, enc(markdown)],
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

async function fileData(lix: Lix, fileId: string): Promise<Uint8Array> {
	const result = await lix.execute("SELECT data FROM lix_file WHERE id = ?", [
		fileId,
	]);
	const { decodeFileDataToBytes } = await import("@/lib/decode-file-data");
	return decodeFileDataToBytes(result.rows[0]?.get("data"));
}
