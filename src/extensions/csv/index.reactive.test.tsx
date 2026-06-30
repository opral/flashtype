import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { CsvView } from "./index";

vi.mock("@glideapps/glide-data-grid", () => ({
	DataEditor: ({
		columns,
		getCellContent,
		rows,
	}: {
		columns: readonly { title: string }[];
		getCellContent: (cell: readonly [number, number]) => {
			displayData: string;
			kind: string;
			data?: string;
		};
		rows: number;
	}) => (
		<div data-testid="csv-data-grid">
			{columns.map((column) => (
				<div key={column.title}>{column.title}</div>
			))}
			{Array.from({ length: rows }, (_, rowIndex) =>
				columns.map((_column, columnIndex) => {
					const cell = getCellContent([columnIndex, rowIndex]);
					return (
						<div
							data-cell-data={cell.data}
							data-cell-kind={cell.kind}
							data-testid={`csv-cell-${rowIndex}-${columnIndex}`}
							key={`${rowIndex}-${columnIndex}`}
						>
							{cell.displayData}
						</div>
					);
				}),
			)}
		</div>
	),
	GridCellKind: {
		Text: "text",
		Uri: "uri",
	},
}));

test("updates when CSV file data changes in Lix", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		const fileId = "file_csv_reactive";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/data.csv",
				data: new TextEncoder().encode(
					"name,value,email,url\nalpha,1,alice@example.com,https://example.com",
				),
			})
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView fileId={fileId} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText("name")).toBeInTheDocument();
		expect(screen.getByTestId("csv-cell-0-2")).toHaveAttribute(
			"data-cell-kind",
			"uri",
		);
		expect(screen.getByTestId("csv-cell-0-2")).toHaveAttribute(
			"data-cell-data",
			"mailto:alice@example.com",
		);
		expect(screen.getByTestId("csv-cell-0-3")).toHaveAttribute(
			"data-cell-kind",
			"uri",
		);
		expect(screen.getByTestId("csv-cell-0-3")).toHaveAttribute(
			"data-cell-data",
			"https://example.com",
		);

		await act(async () => {
			await qb(lix)
				.updateTable("lix_file")
				.set({
					data: new TextEncoder().encode("person,score\nbeta,2\ngamma,3"),
				})
				.where("id", "=", fileId)
				.execute();
		});

		await waitFor(() => {
			expect(screen.getByText("person")).toBeInTheDocument();
		});
	} finally {
		if (utils) {
			const rendered = utils;
			await act(async () => {
				rendered.unmount();
			});
		}
		await lix.close();
	}
});

test("renders a read-only historical CSV snapshot from afterCommitId", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_snapshot",
				path: "/snapshot.csv",
				data: new TextEncoder().encode("name,value\nsnapshot,1"),
			})
			.execute();
		const snapshotCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("name,value\nhead,2") })
			.where("id", "=", "file_csv_snapshot")
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_csv_snapshot"
							filePath="/snapshot.csv"
							afterCommitId={snapshotCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText("snapshot")).toBeInTheDocument();
		expect(screen.queryByText("head")).toBeNull();
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

test("renders a read-only CSV diff from beforeCommitId to HEAD", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_head_diff",
				path: "/head-diff.csv",
				data: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("name,value\nhead,2") })
			.where("id", "=", "file_csv_head_diff")
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_csv_head_diff"
							filePath="/head-diff.csv"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.container.querySelector(".csv-review-table")).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

test("does not mark unchanged before-to-HEAD CSV files as fully added", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_unchanged_head_diff",
				path: "/unchanged-head-diff.csv",
				data: new TextEncoder().encode("name,value\nstable,1"),
			})
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv_other_head_diff",
				path: "/other-head-diff.csv",
				data: new TextEncoder().encode("name,value\nbefore,1"),
			})
			.execute();
		const beforeCommitId = await activeCommitId(lix);
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("name,value\nafter,2") })
			.where("id", "=", "file_csv_other_head_diff")
			.execute();

		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_csv_unchanged_head_diff"
							filePath="/unchanged-head-diff.csv"
							beforeCommitId={beforeCommitId}
							isActiveView
							isPanelFocused
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(screen.getAllByText("stable").length).toBeGreaterThan(0);
		});
		expect(
			utils!.container.querySelector("[data-diff-status='added']"),
		).toBeNull();
		expect(
			utils!.container.querySelector("[data-diff-status='removed']"),
		).toBeNull();
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

test("renders checkpoint CSV diffs without review controls for missing active files", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CsvView
							fileId="file_checkpoint_csv"
							filePath="/checkpoint.csv"
							isActiveView
							isPanelFocused
							beforeCommitId="before-commit"
							afterCommitId="after-commit"
							checkpointDiff={{
								branchId: "checkpoint-after",
								branchName: "After",
								beforeBranchId: "checkpoint-before",
								beforeBranchName: "Before",
								beforeCommitId: "before-commit",
								afterCommitId: "after-commit",
								files: [
									{
										fileId: "file_checkpoint_csv",
										path: "/checkpoint.csv",
										beforePath: "/checkpoint.csv",
										afterPath: "/checkpoint.csv",
										beforeData: new TextEncoder().encode("name,value\nalpha,1"),
										afterData: new TextEncoder().encode("name,value\nalpha,2"),
										beforeCommitId: "before-commit",
										afterCommitId: "after-commit",
										reviewId: "checkpoint:csv",
										status: "modified",
									},
								],
							}}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.container.querySelector(".csv-review-table")).toBeTruthy();
		});
		expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
		expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
	} finally {
		if (utils) {
			await act(async () => {
				utils!.unmount();
			});
		}
		await lix.close();
	}
});

async function activeCommitId(lix: Awaited<ReturnType<typeof openLix>>) {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	return result.rows[0]?.get("commit_id") as string;
}
