import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import {
	openLix,
	bundledPluginArchives,
	type Lix,
} from "@/test-utils/node-lix-sdk";
import { MarkdownView } from "./index";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { qb } from "@/lib/lix-kysely";
import { getExternalWriteReview } from "@/shell/external-write-review-history";

describe("MarkdownView", () => {
	test("throws when no file id is provided", () => {
		expect(() => render(<MarkdownView {...({} as any)} />)).toThrow(
			"MarkdownView requires a non-empty fileId.",
		);
	});

	test("renders the TipTap editor when file is found", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_1",
				path: "/docs/readme.md",
				data: new TextEncoder().encode("# Hello world"),
			})
			.execute();

		await qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: "flashtype_active_file_id",
				value: "file_1",
				lixcol_branch_id: "global",
				lixcol_global: true,
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
				.selectFrom("lix_key_value_by_branch")
				.where("key", "=", "flashtype_active_file_id")
				.select(["value"])
				.execute();
			expect(rows[0]?.value).toBe("file_1");
		});

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shows an autosave hint when pressing Cmd+S", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_autosave_hint",
				path: "/docs/autosave.md",
				data: new TextEncoder().encode("# Autosave"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId="file_autosave_hint"
								filePath="/docs/autosave.md"
								isActiveView
								isPanelFocused
								syncActiveFile={false}
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();

		const event = new KeyboardEvent("keydown", {
			key: "s",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		await act(async () => {
			window.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(await screen.findByRole("status")).toHaveTextContent(
			/auto-saved.*no cmd\+s needed/i,
		);

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the TipTap editor for .markdown files", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_markdown",
				path: "/docs/guide.markdown",
				data: new TextEncoder().encode("# Guide"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId="file_markdown"
								filePath="/docs/guide.markdown"
								syncActiveFile={false}
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the TipTap editor for uppercase markdown extensions", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_uppercase",
				path: "/docs/README.MD",
				data: new TextEncoder().encode("# Readme"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId="file_uppercase"
								filePath="/docs/README.MD"
								syncActiveFile={false}
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(await screen.findByTestId("tiptap-editor")).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("shows an unsupported file prompt for non-markdown files", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv",
				path: "/data.csv",
				data: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView fileId="file_csv" filePath="/data.csv" />
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByText(/this file type is not supported yet/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /open an issue/i }),
		).toHaveAttribute("href", "https://github.com/opral/flashtype/issues");
		expect(screen.queryByText(/alpha,1/)).not.toBeInTheDocument();
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("does not sync unsupported files as the active markdown file", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_csv",
				path: "/data.csv",
				data: new TextEncoder().encode("name,value\nalpha,1"),
			})
			.execute();
		await qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: "flashtype_active_file_id",
				value: "existing_markdown",
				lixcol_branch_id: "global",
				lixcol_global: true,
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
								fileId="file_csv"
								filePath="/data.csv"
								isActiveView
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByText(/this file type is not supported yet/i),
		).toBeInTheDocument();

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});

		const record = await qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.select(["value"])
			.where("key", "=", "flashtype_active_file_id")
			.executeTakeFirst();
		expect(record?.value).toBe("existing_markdown");

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the requested file even if a different active file is stored", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_alpha",
				path: "/alpha.md",
				data: new TextEncoder().encode("# Alpha"),
			})
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_beta",
				path: "/beta.md",
				data: new TextEncoder().encode("# Beta"),
			})
			.execute();

		// Persist a stale active file id pointing to alpha
		await qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: "flashtype_active_file_id",
				value: "file_alpha",
				lixcol_branch_id: "global",
				lixcol_global: true,
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
				.selectFrom("lix_key_value_by_branch")
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

		expect(await screen.findByText(/file not found/i)).toBeInTheDocument();
		expect(screen.queryByTestId("tiptap-editor")).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("renders the per-change stepper for a safe external write review", async () => {
		const lix = await openLix();
		await installBundledPlugins(lix);
		const path = "/docs/review.md";
		await writeMarkdownFile(lix, path, "# Title\n\nAlpha.\n\nBeta.\n");
		const fileId = await fileIdByPath(lix, path);
		await writeMarkdownFile(
			lix,
			path,
			"# Title\n\nAlpha edited.\n\nBeta edited.\n",
		);
		const review = await getExternalWriteReview(lix, fileId, path);
		expect(review).not.toBeNull();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId={fileId}
								filePath={path}
								isActiveView
								isPanelFocused
								syncActiveFile={false}
								externalWriteReview={review}
								onResolveReviewDiff={async () => "applied"}
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByRole("group", { name: "Per-change review actions" }),
		).toBeInTheDocument();
		expect(await screen.findByText("1 of 2")).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("uses classic controls for a single-change review even when granular is wired", async () => {
		const lix = await openLix();
		await installBundledPlugins(lix);
		const path = "/docs/review-single.md";
		await writeMarkdownFile(lix, path, "# Title\n\nAlpha.\n\nBeta.\n");
		const fileId = await fileIdByPath(lix, path);
		// Only the first paragraph changes -> exactly one granular change.
		await writeMarkdownFile(lix, path, "# Title\n\nAlpha edited.\n\nBeta.\n");
		const review = await getExternalWriteReview(lix, fileId, path);
		expect(review).not.toBeNull();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId={fileId}
								filePath={path}
								isActiveView
								isPanelFocused
								syncActiveFile={false}
								externalWriteReview={review}
								onResolveReviewDiff={async () => "applied"}
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		// A single change is all-or-nothing, so the classic controls are shown
		// rather than a "1 of 1" stepper.
		expect(
			await screen.findByRole("group", {
				name: "External write review actions",
			}),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("group", { name: "Per-change review actions" }),
		).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});

	test("falls back to classic controls when no granular resolver is wired", async () => {
		const lix = await openLix();
		await installBundledPlugins(lix);
		const path = "/docs/review-classic.md";
		await writeMarkdownFile(lix, path, "# Title\n\nAlpha.\n\nBeta.\n");
		const fileId = await fileIdByPath(lix, path);
		await writeMarkdownFile(
			lix,
			path,
			"# Title\n\nAlpha edited.\n\nBeta edited.\n",
		);
		const review = await getExternalWriteReview(lix, fileId, path);

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId={fileId}
								filePath={path}
								isActiveView
								isPanelFocused
								syncActiveFile={false}
								externalWriteReview={review}
							/>
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByRole("group", {
				name: "External write review actions",
			}),
		).toBeInTheDocument();
		expect(screen.queryByText("1 of 2")).not.toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
	});
});

async function writeMarkdownFile(
	lix: Lix,
	path: string,
	markdown: string,
): Promise<void> {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES (?, ?) \
		 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[path, new TextEncoder().encode(markdown)],
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
