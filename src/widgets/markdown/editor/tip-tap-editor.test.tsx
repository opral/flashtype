import React, { Suspense, StrictMode } from "react";
import { markdownPluginV2ArchiveBytes } from "@/test-utils/plugin-md-v2-archive";
import { expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import {
	render,
	waitFor,
	screen,
	act,
	fireEvent,
} from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@lix-js/sdk";
import { TipTapEditor } from "./tip-tap-editor";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { EditorProvider } from "./editor-context";
import type { Editor } from "@tiptap/core";
import { insertMarkdownSchemas } from "../../../lib/insert-markdown-schemas";

function Providers({
	lix,
	defs,
	children,
}: {
	lix: Lix;
	defs?: any;
	children: React.ReactNode;
}) {
	return (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs ?? KEY_VALUE_DEFINITIONS}>
				<EditorProvider>{children}</EditorProvider>
			</KeyValueProvider>
		</LixProvider>
	);
}

// Removed CaptureEditor and editor ref helpers; interact via DOM instead

test("renders initial document content", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });
	const fileId = "file_render_doc";

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/render.md",
			data: new TextEncoder().encode("Hello"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "flashtype_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editor = await screen.findByTestId("tiptap-editor");
	expect(editor).toHaveTextContent("Hello");
});

test("persists state changes on edit (paragraph append)", async () => {
	const fileId = "file_1";
	const markdown = "# Title\n\nHello";

	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "flashtype_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/test.md",
			data: new TextEncoder().encode(markdown),
		})
		.execute();

	let editorRef: Editor = undefined as any;

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor
						onReady={(editor) => (editorRef = editor)}
						persistDebounceMs={0}
					/>
				</Providers>
			</Suspense>,
		);
	});

	await waitFor(async () => {
		const end = editorRef.state.doc.content.size;
		editorRef.commands.insertContentAt(end, {
			type: "paragraph",
			content: [{ type: "text", text: "New Paragraph" }],
		});
	});

	await waitFor(async () => {
		const row = await qb(lix)
			.selectFrom("lix_file")
			.where("id", "=", fileId)
			.select("data")
			.executeTakeFirstOrThrow();
		const markdown = new TextDecoder().decode(row.data ?? new Uint8Array());
		expect(markdown).toContain("New Paragraph");
	});
});

test("renders content under React.StrictMode", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	const fileId = "file_strict";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/strict.md",
			data: new TextEncoder().encode("Hello Strict"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "flashtype_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	await act(async () => {
		render(
			<StrictMode>
				<Suspense>
					<Providers lix={lix}>
						<TipTapEditor />
					</Providers>
				</Suspense>
			</StrictMode>,
		);
	});

	const editor = await screen.findByTestId("tiptap-editor");
	await waitFor(() => expect(editor).toHaveTextContent("Hello Strict"));
});

test("shows placeholder only while focused on an empty document", async () => {
	const fileId = "file_placeholder_focus";
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "flashtype_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/placeholder.md",
			data: new TextEncoder().encode(""),
		})
		.execute();

	let editorRef: Editor | null = null;

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor onReady={(editor) => (editorRef = editor)} />
				</Providers>
			</Suspense>,
		);
	});

	const editorNode = await screen.findByTestId("tiptap-editor");

	const container = editorNode.closest(".tiptap-container");
	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("false");
		const paragraph = editorNode.querySelector("p");
		expect(paragraph).toBeTruthy();
	});

	await act(async () => {
		fireEvent.mouseDown(container as HTMLElement);
		fireEvent.click(container as HTMLElement);
	});

	await waitFor(() => {
		const paragraph = editorNode.querySelector("p");
		expect(paragraph?.getAttribute("data-placeholder")).toBe("Start typing...");
		expect(container?.getAttribute("data-editor-focused")).toBe("true");
	});

	await act(async () => {
		editorRef?.commands.blur();
	});

	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("false");
	});
});

test("clicking the surface focuses the editor even when content exists", async () => {
	const fileId = "file_focus_surface";
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
			{
				key: "flashtype_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/has-content.md",
			data: new TextEncoder().encode("Hello world"),
		})
		.execute();

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editorNode = await screen.findByTestId("tiptap-editor");
	const container = editorNode.closest(".tiptap-container");
	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("false");
	});

	await act(async () => {
		fireEvent.mouseDown(container as HTMLElement);
		fireEvent.click(container as HTMLElement);
	});

	await waitFor(() => {
		expect(container?.getAttribute("data-editor-focused")).toBe("true");
	});
});

test("updates editor when switching to a branch with different external state", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	// Create a file and set it active
	const fileId = "file_switch_branch";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/switch.md",
			data: new TextEncoder().encode("Hello A"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "flashtype_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	const branchB = await lix.createBranch({ name: "Draft" });

	await qb(lix)
		.updateTable("lix_file_by_branch")
		.set({ data: new TextEncoder().encode("Hello B") })
		.where("id", "=", fileId)
		.where("lixcol_branch_id", "=", branchB.id)
		.execute();

	// Initial render in base branch
	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editorA = await screen.findByTestId("tiptap-editor");
	expect(editorA).toHaveTextContent("Hello A");

	// Switch to branch B; the editor should reflect branch B's content "Hello B"
	await act(async () => {
		await lix.switchBranch({ branchId: branchB.id });
	});

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent("Hello B");
	});
});

test("updates editor when file.data is updated externally (simulate updateFile with markdown)", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});
	await insertMarkdownSchemas({ lix });

	const fileId = "file_update_blob";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/blob.md",
			data: new TextEncoder().encode("Hello A"),
		})
		.execute();

	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "flashtype_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});

	const editorA = await screen.findByTestId("tiptap-editor");
	expect(editorA).toHaveTextContent("Hello A");

	// External: write markdown into file.data directly (simulating lix.updateFile)
	await qb(lix)
		.updateTable("lix_file")
		.set({ data: new TextEncoder().encode("Hello B from file.data") })
		.where("id", "=", fileId)
		.execute();

	// Expect editor to pick up the updated file content (currently fails)
	await waitFor(async () => {
		const editorB = await screen.findByTestId("tiptap-editor");
		expect(editorB).toHaveTextContent("Hello B from file.data");
	});
});

test("preserves main content when switching to a new branch and back", async () => {
	const lix = await openLix({
		keyValues: [
			{
				key: "lix_deterministic_mode",
				value: { enabled: true },
				lixcol_branch_id: "global",
				lixcol_global: true,
			},
		],
	});
	await lix.installPlugin({
		archiveBytes: markdownPluginV2ArchiveBytes,
	});

	const fileId = "file_regression_main_preserve";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/regression.md",
			data: new TextEncoder().encode("Hello world"),
		})
		.execute();

	// Activate file globally
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: "flashtype_active_file_id",
			value: fileId,
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();

	// Remember currently active branch id (main)
	const mainId = await lix.activeBranchId();

	await insertMarkdownSchemas({ lix });

	// Render editor on main
	await act(async () => {
		render(
			<Suspense>
				<Providers lix={lix}>
					<TipTapEditor />
				</Providers>
			</Suspense>,
		);
	});
	const editorA = await screen.findByTestId("tiptap-editor");
	expect(editorA).toHaveTextContent("Hello world");

	// Create a new branch from main and switch to it
	const vB = await lix.createBranch({ name: "Draft" });
	await act(async () => {
		await lix.switchBranch({ branchId: vB.id });
	});

	// Switch back to main; the content should still be "Hello world"
	await act(async () => {
		await lix.switchBranch({ branchId: mainId });
	});

	await waitFor(() => {
		expect(screen.getByTestId("tiptap-editor")).toHaveTextContent(
			"Hello world",
		);
	});
});
