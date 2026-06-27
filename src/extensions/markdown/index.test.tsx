import { Suspense } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { MarkdownView } from "./index";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import { qb } from "@/lib/lix-kysely";
import { appendAgentTurnCommitRange } from "@/shell/agent-turn-review-range";

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

	test("shows review controls for a file already mounted before the range is persisted", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "file_review_startup",
				path: "/review-startup.md",
				data: new TextEncoder().encode("# Before"),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<MarkdownView
								fileId="file_review_startup"
								filePath="/review-startup.md"
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
		const beforeCommitId = await activeCommitId(lix);

		await act(async () => {
			await qb(lix)
				.updateTable("lix_file")
				.set({ data: new TextEncoder().encode("# After") })
				.where("id", "=", "file_review_startup")
				.execute();
		});
		const afterCommitId = await activeCommitId(lix);

		await act(async () => {
			await appendAgentTurnCommitRange(lix, {
				id: "range-review-startup",
				agent: "codex",
				beforeCommitId,
				afterCommitId,
				startedAt: 1,
				completedAt: 2,
			});
		});

		expect(
			await screen.findByRole("button", { name: /accept/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();

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
});

async function activeCommitId(lix: Awaited<ReturnType<typeof openLix>>) {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	return result.rows[0]?.get("commit_id") as string;
}
