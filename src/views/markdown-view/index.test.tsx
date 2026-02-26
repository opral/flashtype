import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@lix-js/react-utils";
import { openLix } from "@lix-js/sdk";
import { MarkdownView } from "./index";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import markdownPluginV2Manifest from "../../../lix/packages/plugin-md-v2/manifest.json";
import markdownPluginV2WasmRaw from "../../../lix/target/wasm32-wasip2/release/plugin_md_v2.wasm?raw";
import { qb } from "@lix-js/kysely";

const markdownPluginV2WasmBytes = Uint8Array.from(
	markdownPluginV2WasmRaw,
	(char) => char.charCodeAt(0),
);

describe("MarkdownView", () => {
	test("renders an empty state when no file is provided", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			manifestJson: markdownPluginV2Manifest,
			wasmBytes: markdownPluginV2WasmBytes,
		});

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView />
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(
			screen.getByText(/select a markdown file to preview/i),
		).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the TipTap editor when file is found", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			manifestJson: markdownPluginV2Manifest,
			wasmBytes: markdownPluginV2WasmBytes,
		});
		await qb(lix)
			.insertInto("file")
			.values({
				id: "file_1",
				path: "/docs/readme.md",
				data: new TextEncoder().encode("# Hello world"),
			})
			.execute();

		await qb(lix)
			.insertInto("key_value_by_version")
			.values({
				key: "flashtype_active_file_id",
				value: "file_1",
				lixcol_version_id: "global",
				lixcol_untracked: true,
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView fileId="file_1" filePath="/docs/readme.md" />
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();

		await waitFor(async () => {
			const rows = await qb(lix)
				.selectFrom("key_value_by_version")
				.where("key", "=", "flashtype_active_file_id")
				.select(["value"])
				.execute();
			expect(rows[0]?.value).toBe("file_1");
		});

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the requested file even if a different active file is stored", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			manifestJson: markdownPluginV2Manifest,
			wasmBytes: markdownPluginV2WasmBytes,
		});
		await qb(lix)
			.insertInto("file")
			.values({
				id: "file_alpha",
				path: "/alpha.md",
				data: new TextEncoder().encode("# Alpha"),
			})
			.execute();

		await qb(lix)
			.insertInto("file")
			.values({
				id: "file_beta",
				path: "/beta.md",
				data: new TextEncoder().encode("# Beta"),
			})
			.execute();

		// Persist a stale active file id pointing to alpha
		await qb(lix)
			.insertInto("key_value_by_version")
			.values({
				key: "flashtype_active_file_id",
				value: "file_alpha",
				lixcol_version_id: "global",
				lixcol_untracked: true,
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId="file_beta"
								filePath="/beta.md"
								isActiveView
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		const editor = await screen.findByTestId("tiptap-editor");
		expect(editor).toHaveTextContent("Beta");

		await waitFor(async () => {
			const record = await qb(lix)
				.selectFrom("key_value_by_version")
				.select(["value"])
				.where("key", "=", "flashtype_active_file_id")
				.executeTakeFirst();
			expect(record?.value).toBe("file_beta");
		});

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shows a not found message when the file is missing", async () => {
		const lix = await openLix();
		await lix.installPlugin({
			manifestJson: markdownPluginV2Manifest,
			wasmBytes: markdownPluginV2WasmBytes,
		});

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView fileId="missing_file" />
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(screen.getByText(/file not found/i)).toBeInTheDocument();
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});
});
