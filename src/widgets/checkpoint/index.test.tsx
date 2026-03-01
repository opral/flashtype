import React, { Suspense } from "react";
import { markdownPluginV2ArchiveBytes } from "@/test-utils/plugin-md-v2-archive";
import { describe, expect, test, vi } from "vitest";
import { qb } from "@lix-js/kysely";
import {
	render,
	fireEvent,
	waitFor,
	act,
	screen,
} from "@testing-library/react";
import { LixProvider } from "@lix-js/react-utils";
import { openLix } from "@lix-js/sdk";
import { CheckpointView, widget as checkpointViewDefinition } from "./index";
import type { WidgetContext, WidgetInstance } from "../../widget-runtime/types";
import {
	CHECKPOINT_WIDGET_KIND,
	DIFF_WIDGET_KIND,
	HISTORY_WIDGET_KIND,
	diffWidgetInstance,
	historyWidgetInstance,
} from "../../widget-runtime/widget-instance-helpers";

async function countCommits(lix: Awaited<ReturnType<typeof openLix>>) {
	const rows = await qb(lix).selectFrom("lix_commit").select("id").execute();
	return rows.length;
}

describe("CheckpointView", () => {
	test("creates a checkpoint when clicking the button", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});

		const fileId = "checkpoint_view_test_file";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/docs/checkpoint.md",
				data: new TextEncoder().encode("Initial content"),
			})
			.execute();

		await lix.createCheckpoint();

		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("Updated content") })
			.where("id", "=", fileId)
			.execute();
		const before = await countCommits(lix);

		let utils: ReturnType<typeof render>;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointView />
					</Suspense>
				</LixProvider>,
			);
		});

		const { findByTestId } = utils!;

		const button = (await findByTestId(
			"checkpoint-submit",
		)) as HTMLButtonElement;

		fireEvent.click(button);
		await waitFor(() => expect(button).toBeDisabled());

		await waitFor(async () => {
			const after = await countCommits(lix);
			expect(after).toBeGreaterThan(before);
		});

		await waitFor(() => expect(button).not.toBeDisabled());
	});

	test("updates tab badge count based on working changes", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "badge-file",
				path: "/docs/example.md",
				data: new TextEncoder().encode("Initial"),
			})
			.execute();
		await lix.createCheckpoint();
		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("Changed") })
			.where("id", "=", "badge-file")
			.execute();

		const setTabBadgeCount = vi.fn();
		const context = {
			isPanelFocused: true,
			setTabBadgeCount,
			lix,
		} satisfies WidgetContext;

		const instance: WidgetInstance = {
			instance: "checkpoint-1",
			kind: CHECKPOINT_WIDGET_KIND,
		};

		const { unmount } = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<CheckpointView context={context} />
				</Suspense>
			</LixProvider>,
		);

		const cleanup = checkpointViewDefinition.activate?.({
			context,
			instance,
		});

		await waitFor(() => expect(setTabBadgeCount).toHaveBeenCalledWith(1));
		cleanup?.();
		unmount();
	});

	test("invokes openWidget for history when clicking View checkpoints", async () => {
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
						<CheckpointView
							context={{
								openWidget,
								setTabBadgeCount: () => {},
								lix,
							}}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const button = (await utils!.findByRole("button", {
			name: /view checkpoints/i,
		})) as HTMLButtonElement;

		fireEvent.click(button);
		expect(openWidget).toHaveBeenCalledWith({
			panel: "central",
			kind: HISTORY_WIDGET_KIND,
			instance: historyWidgetInstance(),
			focus: true,
		});
	});

	test("opens a diff as a pending preview when clicking a file row", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			archiveBytes: markdownPluginV2ArchiveBytes,
		});
		const fileId = "diff-preview-file";

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/docs/diff-preview.md",
				data: new TextEncoder().encode("# Before"),
			})
			.execute();

		await lix.createCheckpoint();

		await qb(lix)
			.updateTable("lix_file")
			.set({ data: new TextEncoder().encode("# After") })
			.where("id", "=", fileId)
			.execute();

		const openWidget = vi.fn();

		await act(async () => {
			render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointView
							context={{
								openWidget,
								setTabBadgeCount: () => {},
								lix,
							}}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const fileButton = await screen.findByRole("button", {
			name: /diff-preview\.md/i,
		});

		fireEvent.click(fileButton);

		expect(openWidget).toHaveBeenCalledTimes(1);
		const [args] = openWidget.mock.calls[0] ?? [];
		expect(args).toMatchObject({
			panel: "central",
			kind: DIFF_WIDGET_KIND,
			instance: diffWidgetInstance(fileId),
			pending: true,
			focus: true,
		});
		expect(args.state).toMatchObject({
			fileId,
			filePath: "/docs/diff-preview.md",
			flashtype: { label: "diff-preview.md" },
		});
		expect(args.state?.diff).toBeDefined();
	});
});
