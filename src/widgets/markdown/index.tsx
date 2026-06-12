import { Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import { LixProvider, useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { isMarkdownFilePath } from "@/lib/path";
import { EditorProvider } from "@/widgets/markdown/editor/editor-context";
import { TipTapEditor } from "@/widgets/markdown/editor/tip-tap-editor";
import "./style.css";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { FILE_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";

type MarkdownViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly focusOnLoad?: boolean;
	readonly syncActiveFile?: boolean;
};

/**
 * Embeds the shared TipTap editor to render Markdown documents.
 *
 * @example
 * <MarkdownView fileId="file-123" filePath="/docs/guide.md" isActiveView />
 */
export function MarkdownView({
	fileId,
	filePath,
	isActiveView = true,
	focusOnLoad = false,
	syncActiveFile = true,
}: MarkdownViewProps) {
	return (
		<Suspense fallback={<MarkdownLoadingSpinner />}>
			<MarkdownViewContent
				fileId={fileId}
				filePath={filePath}
				isActiveView={isActiveView}
				focusOnLoad={focusOnLoad}
				syncActiveFile={syncActiveFile}
			/>
		</Suspense>
	);
}

function MarkdownViewContent({
	fileId,
	isActiveView = true,
	focusOnLoad = false,
	syncActiveFile = true,
}: MarkdownViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.where("id", "=", fileId)
				.limit(1),
		{ subscribe: false },
	);

	let content: ReactNode;

	if (!fileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-neutral-500">
				File not found in the workspace.
			</div>
		);
	} else if (!isMarkdownFilePath(fileRow.path)) {
		content = <UnsupportedFilePlaceholder filePath={fileRow.path} />;
	} else {
		content = (
			<EditorProvider>
				<div className="markdown-view flex h-full flex-col bg-background">
					<FormattingToolbar className="mb-3" />
					<TipTapEditor
						className="flex-1"
						fileId={fileRow.id}
						isActiveView={isActiveView}
						focusOnLoad={focusOnLoad}
					/>
					<SlashCommandMenu />
				</div>
			</EditorProvider>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col px-2 py-2">
			{syncActiveFile && fileRow && isMarkdownFilePath(fileRow.path) ? (
				<ActiveFileSync fileId={fileRow?.id} isActiveView={isActiveView} />
			) : null}
			{content}
		</div>
	);
}

function UnsupportedFilePlaceholder({
	filePath,
}: {
	readonly filePath: string;
}): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-neutral-600">
				<p className="font-medium text-neutral-800">
					This file type is not supported yet.
				</p>
				<p>
					Flashtype only opens markdown files in this editor, so{" "}
					<span className="font-mono text-xs text-neutral-700">{filePath}</span>{" "}
					was left blank to avoid damaging its formatting.
				</p>
				<p>
					<a
						href="https://github.com/opral/flashtype/issues"
						target="_blank"
						rel="noopener noreferrer"
						className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
					>
						Open an issue on GitHub
					</a>{" "}
					for support for more file types.
				</p>
			</div>
		</div>
	);
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("MarkdownView requires a non-empty fileId.");
	}
}

function ActiveFileSync({
	fileId,
	isActiveView,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
}) {
	const activeFile = useQueryTakeFirst<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("lixcol_branch_id", "=", "global")
			.where("key", "=", "flashtype_active_file_id")
			.select(["value"]),
	);

	return (
		<ActiveFileSyncEffect
			fileId={fileId}
			isActiveView={isActiveView}
			activeFileId={
				typeof activeFile?.value === "string" ? activeFile.value : null
			}
		/>
	);
}

function ActiveFileSyncEffect({
	fileId,
	isActiveView,
	activeFileId,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
	readonly activeFileId: string | null;
}) {
	const lix = useLix();

	useEffect(() => {
		if (!fileId) return;
		if (!isActiveView) return;
		if (activeFileId === fileId) return;
		void qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: "flashtype_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			})
			.onConflict((oc) =>
				oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value: fileId }),
			)
			.execute();
	}, [lix, fileId, activeFileId, isActiveView]);

	return null;
}

function MarkdownLoadingSpinner(): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading editor…</span>
			</div>
		</div>
	);
}

/**
 * Markdown content view definition used by the registry.
 *
 * @example
 * import { widget as markdownView } from "@/widgets/markdown";
 */
export const widget = createReactWidgetDefinition({
	kind: FILE_WIDGET_KIND,
	label: "File",
	description: "Display file contents.",
	icon: FileText,
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<MarkdownView
				fileId={instance.state?.fileId as string}
				filePath={instance.state?.filePath as string | undefined}
				isActiveView={context.isActiveView ?? false}
				focusOnLoad={Boolean(instance.state?.focusOnLoad)}
				syncActiveFile={false}
			/>
		</LixProvider>
	),
});
