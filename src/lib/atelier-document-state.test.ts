import { describe, expect, test, vi } from "vitest";
import type { Lix, LixRuntimeQueryResult } from "@/lib/lix-types";
import {
	readAtelierDocumentSessionState,
	readCurrentAtelierDocumentPath,
} from "./atelier-document-state";

describe("readCurrentAtelierDocumentPath", () => {
	test("returns the current Lix path for Atelier's active main document", async () => {
		const lix = createTestLix({
			state: uiState(
				[
					documentView("file_one", "/old-name.md"),
					documentView("file_two", "/second.md"),
				],
				"atelier_file:file_one",
			),
			files: { file_one: "/renamed.md", file_two: "/second.md" },
		});

		await expect(readCurrentAtelierDocumentPath(lix, lix.state)).resolves.toBe(
			"/renamed.md",
		);
	});

	test("uses the first main view when no active instance is persisted", async () => {
		const lix = createTestLix({
			state: uiState([documentView("file_one", "/one.md")], null),
			files: { file_one: "/one.md" },
		});

		await expect(readCurrentAtelierDocumentPath(lix, lix.state)).resolves.toBe(
			"/one.md",
		);
	});

	test("returns validated active and open main document paths for sessions", async () => {
		const lix = createTestLix({
			state: uiState(
				[
					documentView("file_one", "/old-one.md"),
					documentView("file_two", "/old-two.md"),
					documentView("file_missing", "/missing.md"),
				],
				"atelier_file:file_two",
			),
			files: { file_one: "/one.md", file_two: "/renamed-two.md" },
		});

		await expect(
			readAtelierDocumentSessionState(lix, lix.state),
		).resolves.toEqual({
			activePath: "/renamed-two.md",
			openPaths: ["/renamed-two.md", "/one.md"],
		});
	});

	test("reads host session state without consulting the legacy Lix key", async () => {
		const lix = createTestLix({
			state: null,
			files: { file_one: "/current.md" },
		});

		await expect(
			readAtelierDocumentSessionState(
				lix,
				uiState(
					[documentView("file_one", "/original.md")],
					"atelier_file:file_one",
				),
			),
		).resolves.toEqual({
			activePath: "/current.md",
			openPaths: ["/current.md"],
		});
		expect(
			vi
				.mocked(lix.execute)
				.mock.calls.some(([sql]) =>
					String(sql).includes("lix_key_value_by_branch"),
				),
		).toBe(false);
	});

	test("returns null for the Files landing view", async () => {
		const lix = createTestLix({
			state: uiState(
				[{ instance: "files-default", kind: "atelier_files" }],
				"files-default",
			),
			files: {},
		});

		await expect(
			readCurrentAtelierDocumentPath(lix, lix.state),
		).resolves.toBeNull();
	});

	test("returns null for a malformed document instance", async () => {
		const lix = createTestLix({
			state: uiState(
				[
					{
						...documentView("file_one", "/one.md"),
						instance: "unrelated-instance",
					},
				],
				"unrelated-instance",
			),
			files: { file_one: "/one.md" },
		});

		await expect(
			readCurrentAtelierDocumentPath(lix, lix.state),
		).resolves.toBeNull();
	});

	test("returns null when the persisted document was deleted", async () => {
		const lix = createTestLix({
			state: uiState(
				[documentView("file_deleted", "/deleted.md")],
				"atelier_file:file_deleted",
			),
			files: {},
		});

		await expect(
			readCurrentAtelierDocumentPath(lix, lix.state),
		).resolves.toBeNull();
	});
});

function documentView(fileId: string, filePath: string) {
	return {
		instance: `atelier_file:${fileId}`,
		kind: "atelier_file",
		state: { fileId, filePath },
	};
}

function uiState(views: readonly unknown[], activeInstance: string | null) {
	return {
		areas: {
			main: { views, activeInstance },
		},
	};
}

function createTestLix(args: {
	readonly state: unknown;
	readonly files: Readonly<Record<string, string>>;
}): Lix & { state: unknown } {
	return {
		state: args.state,
		execute: vi.fn(async (sql: string, params?: ReadonlyArray<unknown>) => {
			if (sql.includes("FROM lix_file")) {
				const path = args.files[String(params?.[0])];
				return queryResult(path ? [path] : [], ["path"]);
			}
			throw new Error(`Unexpected query: ${sql}`);
		}),
	} as unknown as Lix & { state: unknown };
}

function queryResult(
	row: readonly unknown[],
	columns: readonly string[],
): LixRuntimeQueryResult {
	return {
		rows: row.length > 0 ? [row] : [],
		columns: columns.map((name) => ({ name, type: "text" })),
		rowsAffected: 0,
		notices: [],
	} as unknown as LixRuntimeQueryResult;
}
