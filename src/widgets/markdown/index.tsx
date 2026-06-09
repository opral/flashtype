import { Suspense, useEffect } from "react";
import type { ReactNode } from "react";
import { FileText, Loader2 } from "lucide-react";
import { LixProvider, useQueryTakeFirst } from "@lix-js/react-utils";
import { qb } from "@lix-js/kysely";
import { useKeyValue } from "@/hooks/key-value/use-key-value";
import { EditorProvider } from "@/widgets/markdown/editor/editor-context";
import { TipTapEditor } from "@/widgets/markdown/editor/tip-tap-editor";
import "./style.css";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { FILE_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";

type MarkdownViewProps = {
	readonly fileId?: string;
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
	filePath,
	isActiveView = true,
	focusOnLoad = false,
	syncActiveFile = true,
}: MarkdownViewProps) {
	const fileRow = useQueryTakeFirst(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path"])
				.where(fileId ? "id" : "path", "=", fileId ?? filePath ?? "")
				.limit(1),
		{ subscribe: false },
	);

	let content: ReactNode;
	const hasTarget = Boolean(fileId || filePath);

	if (!hasTarget) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-neutral-500">
				Select a Markdown file to preview.
			</div>
		);
	} else if (!fileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-neutral-500">
				File not found in the workspace.
			</div>
		);
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
			{syncActiveFile ? (
				<ActiveFileSync fileId={fileRow?.id} isActiveView={isActiveView} />
			) : null}
			{content}
		</div>
	);
}

function ActiveFileSync({
	fileId,
	isActiveView,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
}) {
	const [activeFileId, setActiveFileId] = useKeyValue(
		"flashtype_active_file_id",
	);

	useEffect(() => {
		if (!fileId) return;
		if (!isActiveView) return;
		if (activeFileId === fileId) return;
		void setActiveFileId(fileId);
	}, [fileId, activeFileId, setActiveFileId, isActiveView]);

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
				fileId={instance.state?.fileId as string | undefined}
				filePath={instance.state?.filePath as string | undefined}
				isActiveView={context.isActiveView ?? false}
				focusOnLoad={Boolean(instance.state?.focusOnLoad)}
				syncActiveFile={false}
			/>
		</LixProvider>
	),
});
