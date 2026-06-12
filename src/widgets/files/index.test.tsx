import React, { Suspense } from "react";
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { FilesView } from "./index";
import type { WidgetContext } from "../../widget-runtime/types";
import { qb } from "@/lib/lix-kysely";

const createViewContext = (
	lix: Awaited<ReturnType<typeof openLix>>,
	overrides: Partial<WidgetContext> = {},
): WidgetContext => ({
	setTabBadgeCount: () => {},
	lix,
	...overrides,
});

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
	window.navigator,
	"platform",
);

function setNavigatorPlatform(value: string) {
	Object.defineProperty(window.navigator, "platform", {
		value,
		configurable: true,
	});
}

function isUserPath(path: string): boolean {
	return !path.startsWith("/.lix_system/");
}

describe("FilesView", () => {
	beforeAll(() => {
		setNavigatorPlatform("MacIntel");
	});

	afterAll(() => {
		if (originalPlatformDescriptor) {
			Object.defineProperty(
				window.navigator,
				"platform",
				originalPlatformDescriptor,
			);
		}
	});

	test("creates an inline draft when Cmd+. is pressed", async () => {
		const lix = await openLix();
		const openFile = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});

		const initialRows = await qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path"])
			.execute();
		expect(initialRows.filter((row) => isUserPath(row.path))).toHaveLength(0);

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		expect(input.value).toBe("new-file");

		await act(async () => {
			fireEvent.change(input, { target: { value: "notes" } });
		});

		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.execute();
			const userRows = rows.filter((row) => isUserPath(row.path));
			expect(userRows).toHaveLength(1);
			expect(userRows[0]?.path).toBe("/notes.md");
			const createdId = userRows[0]?.id as string;
			expect(openFile).toHaveBeenCalledWith({
				panel: "central",
				fileId: createdId,
				filePath: "/notes.md",
				state: { focusOnLoad: true },
				focus: true,
			});
		});

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace deletes the selected file", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_1",
				path: "/hello.md",
				data: new Uint8Array(),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.getByText("hello.md")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("hello.md"));
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: "Backspace", metaKey: true });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.execute();
			expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		});

		await waitFor(() => {
			expect(utils!.queryByText("hello.md")).toBeNull();
		});

		utils!.unmount();
		await lix.close();
	});

	test("asks the host to open CSV files", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv",
				path: "/data.csv",
				data: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.getByText("data.csv")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("data.csv"));
		});

		expect(openFile).toHaveBeenCalledWith({
			panel: "central",
			fileId: "file_csv",
			filePath: "/data.csv",
			focus: false,
		});

		utils!.unmount();
		await lix.close();
	});

	test("asks the host to open unsupported files", async () => {
		const lix = await openLix();
		const openFile = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_txt",
				path: "/notes.txt",
				data: new TextEncoder().encode("hello"),
			})
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openFile })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.getByText("notes.txt")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("notes.txt"));
		});

		expect(openFile).toHaveBeenCalledWith({
			panel: "central",
			fileId: "file_txt",
			filePath: "/notes.txt",
			focus: false,
		});

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace deletes the selected directory", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.getByText("docs")).toBeInTheDocument();
		});

		await act(async () => {
			fireEvent.click(utils!.getByText("docs"));
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: "Backspace", metaKey: true });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_directory")
				.select(["path"])
				.execute();
			expect(rows.some((row) => row.path === "/docs/")).toBe(false);
		});

		await waitFor(() => {
			expect(utils!.queryByText("docs")).toBeNull();
		});

		utils!.unmount();
		await lix.close();
	});

	test("hides dot-prefixed files and folder descendants", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/.hidden-folder/" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "visible_file",
					path: "/visible.md",
					data: new Uint8Array(),
				},
				{
					id: "dot_file",
					path: "/.hidden.md",
					data: new Uint8Array(),
				},
				{
					id: "dot_folder_child",
					path: "/.hidden-folder/inside.md",
					data: new Uint8Array(),
				},
			])
			.execute();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView />
					</Suspense>
				</LixProvider>,
			);
		});

		await waitFor(() => {
			expect(utils!.getByText("visible.md")).toBeInTheDocument();
			expect(utils!.queryByText(".hidden.md")).toBeNull();
			expect(utils!.queryByText(".hidden-folder")).toBeNull();
			expect(utils!.queryByText("inside.md")).toBeNull();
		});

		utils!.unmount();
		await lix.close();
	});

	test("replaces whitespace with dashes when creating files", async () => {
		const lix = await openLix();
		const openWidget = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openWidget })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		await act(async () => {
			fireEvent.change(input, { target: { value: "hello nice one" } });
		});

		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_file")
				.select(["path"])
				.execute();
			const userRows = rows.filter((row) => isUserPath(row.path));
			expect(userRows).toHaveLength(1);
			expect(userRows[0]?.path).toBe("/hello-nice-one.md");
		});

		await waitFor(() => {
			expect(utils!.getByText("hello-nice-one.md")).toBeInTheDocument();
		});

		utils!.unmount();
		await lix.close();
	});

	test("creates an inline directory draft when Shift+Cmd+. is pressed", async () => {
		const lix = await openLix();
		const openWidget = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openWidget })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await act(async () => {
			fireEvent.keyDown(document, {
				key: ">",
				code: "Period",
				metaKey: true,
				shiftKey: true,
			});
		});

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;
		expect(input.value).toBe("new-directory");

		await act(async () => {
			fireEvent.change(input, { target: { value: "docs" } });
		});

		await act(async () => {
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("lix_directory")
				.select(["path"])
				.execute();
			expect(rows.some((row) => row.path === "/docs/")).toBe(true);
		});

		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("ignores Ctrl+. on macOS", async () => {
		const lix = await openLix();
		const openWidget = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openWidget })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", ctrlKey: true });
		});

		expect(utils!.queryByTestId("files-view-draft-input")).toBeNull();

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("ignores Ctrl+Shift+. on macOS", async () => {
		const lix = await openLix();
		const openWidget = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openWidget })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await act(async () => {
			fireEvent.keyDown(document, {
				key: ">",
				code: "Period",
				ctrlKey: true,
				shiftKey: true,
			});
		});

		expect(utils!.queryByTestId("files-view-draft-input")).toBeNull();

		const rows = await qb(lix)
			.selectFrom("lix_directory")
			.select(["path"])
			.execute();
		expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("cancels the draft when Escape is pressed", async () => {
		const lix = await openLix();
		const openWidget = vi.fn();

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<FilesView context={createViewContext(lix, { openWidget })} />
					</Suspense>
				</LixProvider>,
			);
		});

		await act(async () => {
			fireEvent.keyDown(document, { key: ".", metaKey: true });
		});

		const input = (await utils!.findByTestId(
			"files-view-draft-input",
		)) as HTMLInputElement;

		await act(async () => {
			fireEvent.keyDown(input, { key: "Escape" });
		});

		await waitFor(() => {
			expect(utils!.queryByTestId("files-view-draft-input")).toBeNull();
		});

		const rows = await qb(lix)
			.selectFrom("lix_file")
			.select(["path"])
			.execute();
		expect(rows.filter((row) => isUserPath(row.path))).toHaveLength(0);
		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});
});
