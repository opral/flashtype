import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent,
} from "react";
import { Toolbar } from "@base-ui-components/react/toolbar";
import { Select } from "@base-ui-components/react/select";
import { Tooltip } from "@base-ui-components/react/tooltip";
import clsx from "clsx";
import {
	Bold,
	Check,
	ChevronDown,
	Code2,
	Copy,
	Italic,
	List,
	ListChecks,
	ListOrdered,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { useEditorCtx } from "../editor/editor-context";
import { buildMarkdownFromEditor } from "../editor/build-markdown-from-editor";
import {
	TOOLBAR_BLOCK_OPTIONS,
	type ToolbarBlockType,
} from "../editor/block-commands";

type FormatState = {
	block: ToolbarBlockType;
	isBold: boolean;
	isItalic: boolean;
	isCode: boolean;
	isBulletList: boolean;
	isOrderedList: boolean;
	isTaskList: boolean;
};

/** 28px square icon button, matching the panel-header chips in the islands UI. */
const iconButtonClass =
	"inline-flex size-7 shrink-0 select-none items-center justify-center rounded-[7px] text-neutral-600 transition-colors hover:bg-hover-soft hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-40";

/** Pressed state for a formatting toggle. */
const iconButtonActiveClass = "bg-neutral-200 text-neutral-900";

const ToolbarSeparator = () => (
	<Toolbar.Separator className="mx-1.5 h-4 w-px bg-island-border" />
);

const initialFormatState: FormatState = {
	block: "paragraph",
	isBold: false,
	isItalic: false,
	isCode: false,
	isBulletList: false,
	isOrderedList: false,
	isTaskList: false,
};

/**
 * Floating toolbar rendering Markdown formatting controls for the TipTap editor.
 *
 * @example
 * <FormattingToolbar className="sticky top-0 z-10" />
 */
export function FormattingToolbar({ className }: { className?: string }) {
	const { editor } = useEditorCtx();
	const [formatState, setFormatState] =
		useState<FormatState>(initialFormatState);
	const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">(
		"idle",
	);
	const [blockMenuOpen, setBlockMenuOpen] = useState(false);
	const longestBlockLabel = useMemo(
		() =>
			TOOLBAR_BLOCK_OPTIONS.reduce(
				(acc, option) =>
					option.label.length > acc.length ? option.label : acc,
				"",
			),
		[],
	);
	const labelMeasureRef = useRef<HTMLSpanElement | null>(null);
	const [labelWidth, setLabelWidth] = useState<number | null>(null);

	const suppressMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
	}, []);

	const hasTaskListCommand = useMemo(
		() =>
			Boolean(
				editor &&
				typeof (editor.commands as any)?.toggleTaskList === "function",
			),
		[editor],
	);

	useEffect(() => {
		if (!editor) return;
		const update = () => {
			setFormatState({
				block: getActiveBlock(editor),
				isBold: editor.isActive("bold"),
				isItalic: editor.isActive("italic"),
				isCode: editor.isActive("code"),
				isBulletList: editor.isActive("bulletList"),
				isOrderedList: editor.isActive("orderedList"),
				isTaskList: computeTaskListActive(editor, hasTaskListCommand),
			});
		};

		update();

		editor.on("selectionUpdate", update);
		editor.on("transaction", update);
		editor.on("update", update);

		return () => {
			editor.off("selectionUpdate", update);
			editor.off("transaction", update);
			editor.off("update", update);
		};
	}, [editor, hasTaskListCommand]);

	const activeBlockLabel = useMemo(() => {
		const active = TOOLBAR_BLOCK_OPTIONS.find(
			(option) => option.value === formatState.block,
		);
		return active?.label ?? "Text";
	}, [formatState.block]);

	const handleBlockChange = useCallback(
		(value: ToolbarBlockType) => {
			if (!editor) return;
			const option = TOOLBAR_BLOCK_OPTIONS.find(
				(entry) => entry.value === value,
			);
			option?.apply(editor);
			setBlockMenuOpen(false);
		},
		[editor],
	);

	const handleToggleBold = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("bold").run();
	}, [editor]);

	const handleToggleItalic = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("italic").run();
	}, [editor]);

	const handleToggleCode = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().toggleMark("code").run();
	}, [editor]);

	const handleToggleBulletList = useCallback(() => {
		if (!editor) return;
		const chain = editor.chain().focus() as any;
		let success = editor.isActive("bulletList")
			? (chain.liftListItem?.("listItem")?.run?.() ?? false)
			: (chain.wrapIn?.("bulletList")?.run?.() ?? false);
		if (!success) {
			const altChain = editor.chain().focus() as any;
			success =
				chain.toggleList?.("bulletList", "listItem")?.run?.() ??
				altChain.toggleBulletList?.()?.run?.() ??
				false;
		}
	}, [editor]);

	const handleToggleOrderedList = useCallback(() => {
		if (!editor) return;
		const chain = editor.chain().focus() as any;
		let success = editor.isActive("orderedList")
			? (chain.liftListItem?.("listItem")?.run?.() ?? false)
			: (chain.wrapIn?.("orderedList")?.run?.() ?? false);
		if (!success) {
			const altChain = editor.chain().focus() as any;
			success =
				chain.toggleList?.("orderedList", "listItem")?.run?.() ??
				altChain.toggleOrderedList?.()?.run?.() ??
				false;
		}
	}, [editor]);

	const handleToggleTaskList = useCallback(() => {
		if (!editor) return;
		if (typeof editor.chain().focus().toggleTaskList === "function") {
			editor.chain().focus().toggleTaskList().run();
			return;
		}
		toggleTaskListFallback(editor);
	}, [editor]);

	const handleCopyMarkdown = useCallback(() => {
		if (!editor) return;
		if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
			setCopyStatus("error");
			return;
		}
		const markdown = buildMarkdownFromEditor(editor);
		navigator.clipboard
			.writeText(markdown)
			.then(() => setCopyStatus("success"))
			.catch(() => {
				setCopyStatus("error");
			});
	}, [editor]);

	useEffect(() => {
		if (copyStatus === "idle") return;
		const reset = window.setTimeout(() => setCopyStatus("idle"), 2000);
		return () => window.clearTimeout(reset);
	}, [copyStatus]);

	useEffect(() => {
		const element = labelMeasureRef.current;
		if (!element) return;
		const initialWidth = Math.ceil(element.getBoundingClientRect().width) + 6;
		setLabelWidth(initialWidth);
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			setLabelWidth(Math.ceil(entry.contentRect.width) + 6);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [longestBlockLabel]);

	if (!editor) return null;

	return (
		<>
			<span
				ref={labelMeasureRef}
				aria-hidden="true"
				className="pointer-events-none select-none text-sm font-medium"
				style={{
					position: "fixed",
					top: -1000,
					left: -1000,
					visibility: "hidden",
					whiteSpace: "nowrap",
				}}
			>
				{longestBlockLabel}
			</span>
			<Toolbar.Root
				className={clsx(
					"flex h-10 w-full shrink-0 items-center gap-0.5 border-b border-island-divider bg-neutral-0 px-2 text-foreground",
					className,
				)}
				aria-label="Formatting toolbar"
			>
				<Toolbar.Group className="flex flex-1 items-center gap-0.5">
					<Select.Root
						value={formatState.block}
						onValueChange={handleBlockChange}
						open={blockMenuOpen}
						onOpenChange={setBlockMenuOpen}
					>
						<Toolbar.Button
							render={<Select.Trigger />}
							nativeButton={false}
							className="inline-flex h-7 shrink-0 select-none items-center gap-1 rounded-[7px] pr-1.5 pl-2.5 text-[12.5px] font-semibold text-neutral-700 transition-colors hover:bg-hover-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring"
							onMouseDown={suppressMouseDown}
						>
							<Select.Value
								className="block truncate"
								style={
									labelWidth != null
										? {
												width: labelWidth,
											}
										: undefined
								}
							>
								{activeBlockLabel}
							</Select.Value>
							<Select.Icon className="text-neutral-400">
								<ChevronDown className="size-3.5" aria-hidden />
							</Select.Icon>
						</Toolbar.Button>
						<Select.Portal>
							<Select.Positioner
								className="z-50 outline-none"
								side="bottom"
								align="start"
								sideOffset={6}
								alignItemWithTrigger={false}
							>
								<Select.Popup className="min-w-[12rem] rounded-lg border border-border bg-card p-1 shadow-xl data-[side=bottom]:mt-2 data-[side=top]:mb-2 origin-[var(--transform-origin)] transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-100 data-[ending-style]:opacity-100">
									<div className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">
										Turn into
									</div>
									{TOOLBAR_BLOCK_OPTIONS.map((option) => (
										<Select.Item
											key={option.value}
											value={option.value}
											className="group flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-0 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
										>
											<span className="flex size-5 items-center justify-center text-muted-foreground group-data-[highlighted]:text-foreground">
												<option.icon className="h-4 w-4" aria-hidden />
											</span>
											<div className="flex flex-1 flex-col">
												<span className="text-sm font-medium">
													{option.label}
												</span>
												<span className="text-xs text-muted-foreground group-data-[highlighted]:text-muted-foreground/80">
													{option.description}
												</span>
											</div>
											<Select.ItemIndicator className="text-foreground">
												<Check className="h-4 w-4" aria-hidden />
											</Select.ItemIndicator>
										</Select.Item>
									))}
								</Select.Popup>
							</Select.Positioner>
						</Select.Portal>
					</Select.Root>

					<ToolbarSeparator />

					<Toolbar.Button
						className={clsx(
							iconButtonClass,
							formatState.isBold && iconButtonActiveClass,
						)}
						onClick={handleToggleBold}
						onMouseDown={suppressMouseDown}
						aria-pressed={formatState.isBold}
						aria-label="Bold"
					>
						<Bold className="size-3.5" aria-hidden />
					</Toolbar.Button>

					<Toolbar.Button
						className={clsx(
							iconButtonClass,
							formatState.isItalic && iconButtonActiveClass,
						)}
						onClick={handleToggleItalic}
						onMouseDown={suppressMouseDown}
						aria-pressed={formatState.isItalic}
						aria-label="Italic"
					>
						<Italic className="size-3.5" aria-hidden />
					</Toolbar.Button>

					<Toolbar.Button
						className={clsx(
							iconButtonClass,
							formatState.isCode && iconButtonActiveClass,
						)}
						onClick={handleToggleCode}
						onMouseDown={suppressMouseDown}
						aria-pressed={formatState.isCode}
						aria-label="Inline code"
					>
						<Code2 className="size-3.5" aria-hidden />
					</Toolbar.Button>

					<ToolbarSeparator />

					<Toolbar.Button
						className={clsx(
							iconButtonClass,
							formatState.isOrderedList && iconButtonActiveClass,
						)}
						onClick={handleToggleOrderedList}
						onMouseDown={suppressMouseDown}
						aria-pressed={formatState.isOrderedList}
						aria-label="Numbered list"
					>
						<ListOrdered className="size-3.5" aria-hidden />
					</Toolbar.Button>

					<Toolbar.Button
						className={clsx(
							iconButtonClass,
							formatState.isBulletList && iconButtonActiveClass,
						)}
						onClick={handleToggleBulletList}
						onMouseDown={suppressMouseDown}
						aria-pressed={formatState.isBulletList}
						aria-label="Bullet list"
					>
						<List className="size-3.5" aria-hidden />
					</Toolbar.Button>

					<Toolbar.Button
						className={clsx(
							iconButtonClass,
							formatState.isTaskList && iconButtonActiveClass,
						)}
						onClick={handleToggleTaskList}
						onMouseDown={suppressMouseDown}
						aria-pressed={formatState.isTaskList}
						aria-label="Checklist"
					>
						<ListChecks className="size-3.5" aria-hidden />
					</Toolbar.Button>
				</Toolbar.Group>

				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Toolbar.Button
								className={clsx(
									iconButtonClass,
									"ml-auto",
									copyStatus === "error" && "text-error-600",
								)}
								onClick={handleCopyMarkdown}
								onMouseDown={suppressMouseDown}
								aria-label={
									copyStatus === "success" ? "Copied markdown" : "Copy markdown"
								}
							>
								<span className="relative inline-flex size-3.5 items-center justify-center">
									<Copy
										className={clsx(
											"size-3.5 transition-all duration-150",
											copyStatus === "success"
												? "scale-75 opacity-0"
												: "scale-100 opacity-100",
										)}
										aria-hidden
									/>
									<Check
										className={clsx(
											"absolute size-3.5 text-success-600 transition-all duration-150",
											copyStatus === "success"
												? "scale-100 opacity-100"
												: "scale-75 opacity-0",
										)}
										aria-hidden
									/>
								</span>
							</Toolbar.Button>
						}
					/>
					<Tooltip.Portal>
						<Tooltip.Positioner side="top" align="center" sideOffset={6}>
							<Tooltip.Popup className="rounded-md border border-border bg-popover px-2 py-1 text-xs text-foreground shadow-md transition-opacity duration-150 data-[state=closed]:opacity-0 data-[state=open]:opacity-100">
								{copyStatus === "success" ? "Copied Markdown" : "Copy Markdown"}
							</Tooltip.Popup>
						</Tooltip.Positioner>
					</Tooltip.Portal>
				</Tooltip.Root>
			</Toolbar.Root>
		</>
	);
}

function getActiveBlock(editor: Editor): ToolbarBlockType {
	if (editor.isActive("heading", { level: 1 })) return "heading-1";
	if (editor.isActive("heading", { level: 2 })) return "heading-2";
	if (editor.isActive("heading", { level: 3 })) return "heading-3";
	if (editor.isActive("codeBlock")) return "code";
	if (editor.isActive("blockquote")) return "blockquote";
	return "paragraph";
}

function computeTaskListActive(editor: Editor, hasTaskListCommand: boolean) {
	if (hasTaskListCommand && editor.isActive("taskList")) return true;
	const listAttrs = editor.getAttributes("bulletList");
	if (listAttrs?.isTaskList) return true;
	const itemAttrs = editor.getAttributes("listItem");
	return typeof itemAttrs?.checked === "boolean";
}

function toggleTaskListFallback(editor: Editor) {
	if (!editor.isActive("bulletList")) {
		const chain = editor.chain().focus() as any;
		const wrapped = chain.wrapIn?.("bulletList")?.run?.();
		if (!wrapped) {
			return;
		}
	}

	const { state, view } = editor;
	const { selection } = state;
	const { from, to } = selection;
	const listItemAttrs = editor.getAttributes("listItem");
	const isCurrentlyTask =
		listItemAttrs && typeof listItemAttrs.checked === "boolean";

	const tr = state.tr;
	let applied = false;

	state.doc.nodesBetween(from, to, (node, pos) => {
		if (node.type.name !== "listItem") return;
		const attrs = { ...node.attrs };
		if (isCurrentlyTask) {
			if (attrs.checked == null) return;
			attrs.checked = null;
		} else {
			if (attrs.checked === false) return;
			attrs.checked = false;
		}
		tr.setNodeMarkup(pos, undefined, attrs);
		applied = true;
	});

	if (applied) {
		view.dispatch(tr);
	}
}
