import React, { Suspense } from "react";
import { markdownPluginV2ArchiveBytes } from "@/test-utils/plugin-md-v2-archive";
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { LixProvider } from "@lix-js/react-utils";
import { openLix } from "@lix-js/sdk";
import { FilesView } from "./index";
import type { WidgetContext } from "../../widget-runtime/types";
import { qb } from "@lix-js/kysely";
import {
	FILE_WIDGET_KIND,
	fileWidgetInstance,
} from "../../widget-runtime/widget-instance-helpers";

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
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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

		const initialRows = await qb(lix)
			.selectFrom("lix_file")
			.select("id")
			.execute();
		expect(initialRows).toHaveLength(0);

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
			expect(rows).toHaveLength(1);
			expect(rows[0]?.path).toBe("/notes.md");
			const createdId = rows[0]?.id as string;
			expect(openWidget).toHaveBeenCalledWith({
				panel: "central",
				kind: FILE_WIDGET_KIND,
				instance: fileWidgetInstance(createdId),
				state: {
					fileId: createdId,
					filePath: "/notes.md",
					flashtype: { label: "notes.md" },
					focusOnLoad: true,
				},
				focus: true,
			});
		});

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace deletes the selected file", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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
			expect(rows).toHaveLength(0);
		});

		await waitFor(() => {
			expect(utils!.queryByText("hello.md")).toBeNull();
		});

		utils!.unmount();
		await lix.close();
	});

	test("Cmd+Backspace deletes the selected directory", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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

	test("hides hidden files by default", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "visible_file",
					path: "/visible.md",
					data: new Uint8Array(),
					hidden: 0,
				},
				{
					id: "hidden_file",
					path: "/.hidden.md",
					data: new Uint8Array(),
					hidden: 1,
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
		});
		expect(utils!.queryByText(".hidden.md")).toBeNull();

		utils!.unmount();
		await lix.close();
	});

	test("shows hidden files when the dev-tools toggle is enabled", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "visible_file",
					path: "/visible.md",
					data: new Uint8Array(),
					hidden: 0,
				},
				{
					id: "hidden_file",
					path: "/.hidden.md",
					data: new Uint8Array(),
					hidden: 1,
				},
			])
			.execute();
		await qb(lix)
			.insertInto("lix_key_value_by_version")
			.values({
				key: "flashtype_show_hidden_files",
				value: true,
				lixcol_version_id: "global",
				lixcol_untracked: true,
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
			expect(utils!.getByText("visible.md")).toBeInTheDocument();
			expect(utils!.getByText(".hidden.md")).toBeInTheDocument();
		});

		utils!.unmount();
		await lix.close();
	});

	test("replaces whitespace with dashes when creating files", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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
			expect(rows).toHaveLength(1);
			expect(rows[0]?.path).toBe("/hello%20nice%20one.md");
		});

		await waitFor(() => {
			expect(utils!.getByText("hello nice one.md")).toBeInTheDocument();
		});

		utils!.unmount();
		await lix.close();
	});

	test("creates an inline directory draft when Shift+Cmd+. is pressed", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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
		expect(rows).toHaveLength(0);
		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("ignores Ctrl+Shift+. on macOS", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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
		expect(rows).toHaveLength(0);
		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});

	test("cancels the draft when Escape is pressed", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
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
		expect(rows).toHaveLength(0);
		expect(openWidget).not.toHaveBeenCalled();

		utils!.unmount();
		await lix.close();
	});
});
