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
