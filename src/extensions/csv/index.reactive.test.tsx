import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { CsvView } from "./index";

test("updates when CSV file data changes in Lix", async () => {
	const lix = await openLix();
	try {
		const fileId = "file_csv_reactive";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/data.csv",
				data: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
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

		await act(async () => {
			utils?.unmount();
		});
	} finally {
		await lix.close();
	}
});
