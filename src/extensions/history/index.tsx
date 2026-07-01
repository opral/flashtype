import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
	History as HistoryIcon,
	Loader2,
	MoreVertical,
	PenLine,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import {
	LixProvider,
	useLix,
	useQuery,
	useQueryTakeFirstOrThrow,
} from "@/lib/lix-react";
import { qb, sql } from "@/lib/lix-kysely";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { HISTORY_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";
import type {
	CheckpointDiff,
	CheckpointDiffBranchRow,
	CheckpointDiffFile,
	ShowCheckpointDiffArgs,
} from "../../extension-runtime/checkpoint-diff";
import { resolveCheckpointDiff } from "@/shell/checkpoint-diff";

type BranchRow = {
	id: string;
	name: string;
	hidden: boolean | null;
	commit_id: string | null;
};

type HistoryViewProps = {
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly showCheckpointDiff?: (
		args: ShowCheckpointDiffArgs,
	) => Promise<CheckpointDiff | null>;
	readonly clearCheckpointDiff?: () => void;
};

const CURRENT_CHECKPOINT_NAME = "main";
const CURRENT_CHECKPOINT_LABEL = "Current Checkpoint";
const UNNAMED_CHECKPOINT_LABEL = "Naming checkpoint...";
const CHECKPOINT_RENAME_DELAY_MS = 5000;
const MAX_CHECKPOINT_DIFF_CONTEXT_LENGTH = 10_000;
const MAX_CHECKPOINT_DIFF_CONTEXT_FILES = 12;
const MAX_CHECKPOINT_DIFF_SNIPPET_LINES = 8;
const MAX_CHECKPOINT_DIFF_SNIPPET_LINE_LENGTH = 160;
const BRANCH_TIMESTAMP_NAME_PATTERN =
	/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?::(.*))?$/u;

type GeneratedCheckpointName = {
	readonly name: string;
	readonly source: "codex" | "claude" | "timestamp";
};

function displayBranchName(branchName: string): string {
	if (branchName === "") {
		return UNNAMED_CHECKPOINT_LABEL;
	}
	if (branchName === CURRENT_CHECKPOINT_NAME) {
		return CURRENT_CHECKPOINT_LABEL;
	}
	const timestampBranch = BRANCH_TIMESTAMP_NAME_PATTERN.exec(branchName);
	if (timestampBranch) {
		const generatedName = timestampBranch[2]?.trim();
		return generatedName || UNNAMED_CHECKPOINT_LABEL;
	}
	return branchName;
}

/**
 * Full-height checkpoint history view for the left pane.
 *
 * @example
 * <HistoryView />
 */
export function HistoryView(props: HistoryViewProps = {}) {
	const lix = useLix();
	return <HistoryBranchesLoader lix={lix} {...props} />;
}

function HistoryBranchesLoader({
	lix,
	...props
}: HistoryViewProps & {
	readonly lix: ReturnType<typeof useLix>;
}) {
	const branches = useQuery<BranchRow>((lix) =>
		qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name", "hidden", "commit_id"])
			.where(
				() =>
					sql`COALESCE(CAST(lix_branch.hidden AS TEXT), 'false') NOT IN ('true', '1', 't')`,
			)
			.orderBy("name", "asc"),
	);
	return <HistoryActiveBranchLoader lix={lix} branches={branches} {...props} />;
}

function HistoryActiveBranchLoader({
	lix,
	branches,
	checkpointDiff,
	showCheckpointDiff,
	clearCheckpointDiff,
}: HistoryViewProps & {
	readonly lix: ReturnType<typeof useLix>;
	readonly branches: BranchRow[];
}) {
	const activeBranch = useQueryTakeFirstOrThrow<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select(["value"]),
	);
	return (
		<HistoryViewContent
			lix={lix}
			branches={branches}
			activeBranchId={activeBranch.value}
			checkpointDiff={checkpointDiff}
			showCheckpointDiff={showCheckpointDiff}
			clearCheckpointDiff={clearCheckpointDiff}
		/>
	);
}

function HistoryViewContent({
	lix,
	branches,
	activeBranchId,
	checkpointDiff,
	showCheckpointDiff,
	clearCheckpointDiff,
}: {
	readonly lix: ReturnType<typeof useLix>;
	readonly branches: BranchRow[];
	readonly activeBranchId: string;
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly showCheckpointDiff?: (
		args: ShowCheckpointDiffArgs,
	) => Promise<CheckpointDiff | null>;
	readonly clearCheckpointDiff?: () => void;
}) {
	const activeBranchRow =
		branches.find((branch) => branch.id === activeBranchId) ??
		({
			id: activeBranchId,
			name: activeBranchId,
			hidden: false,
			commit_id: null,
		} satisfies BranchRow);

	const [pendingAction, setPendingAction] = useState<string | null>(null);
	const renameTimerIdsRef = useRef<Set<number>>(new Set());

	useEffect(() => {
		const renameTimerIds = renameTimerIdsRef.current;
		return () => {
			for (const timerId of renameTimerIds) {
				window.clearTimeout(timerId);
			}
			renameTimerIds.clear();
		};
	}, []);

	const handleSwitch = useCallback(
		async (branchId: string) => {
			if (!lix || branchId === activeBranchRow.id) return;
			setPendingAction(branchId);
			try {
				await lix.switchBranch({ branchId });
				clearCheckpointDiff?.();
			} catch (error) {
				console.error("Failed to switch branch", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix, activeBranchRow.id, clearCheckpointDiff],
	);

	const handleSelectBranch = useCallback(
		async (branchId: string) => {
			if (checkpointDiff?.branchId === branchId) {
				clearCheckpointDiff?.();
				return;
			}
			if (!showCheckpointDiff) return;
			setPendingAction(branchId);
			try {
				const nextDiff = await showCheckpointDiff({ branchId, branches });
				if (!nextDiff) {
					clearCheckpointDiff?.();
				}
			} catch (error) {
				console.error("Failed to resolve checkpoint diff", error);
				clearCheckpointDiff?.();
			} finally {
				setPendingAction(null);
			}
		},
		[
			branches,
			checkpointDiff?.branchId,
			clearCheckpointDiff,
			showCheckpointDiff,
		],
	);

	const handleCreateBranch = useCallback(async () => {
		if (!lix) return;
		setPendingAction("create");
		try {
			const timestamp = formatLocalTimestamp();
			await lix.syncDiskToLix();
			const created = await lix.createBranch({
				name: timestamp,
			});
			const timerId = window.setTimeout(() => {
				renameTimerIdsRef.current.delete(timerId);
				void buildCheckpointNameDiffContextForBranch(lix, created.id)
					.then((diffContext) => generateCheckpointName({ diffContext }))
					.then((checkpointName) => {
						const generatedName = checkpointName.name.trim();
						if (!generatedName || checkpointName.source === "timestamp") {
							return;
						}
						return qb(lix)
							.updateTable("lix_branch")
							.set({ name: `${timestamp}:${generatedName}` })
							.where("id", "=", created.id)
							.where("name", "=", timestamp)
							.execute();
					})
					.catch((error) => {
						console.error("Failed to rename branch", error);
					});
			}, CHECKPOINT_RENAME_DELAY_MS);
			renameTimerIdsRef.current.add(timerId);
		} catch (error) {
			console.error("Failed to create branch", error);
		} finally {
			setPendingAction(null);
		}
	}, [lix]);

	const handleRenameBranch = useCallback(
		async (branchId: string, currentName: string) => {
			const entered = window.prompt("Rename checkpoint", currentName);
			if (entered === null) return;
			const trimmed = entered.trim();
			if (trimmed === "" || trimmed === currentName) return;
			setPendingAction(branchId);
			try {
				await qb(lix)
					.updateTable("lix_branch")
					.set({ name: trimmed })
					.where("id", "=", branchId)
					.execute();
			} catch (error) {
				console.error("Failed to rename branch", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix],
	);

	const handleDeleteBranch = useCallback(
		async (branchId: string, branchName: string) => {
			if (branchId === activeBranchRow.id) {
				window.alert("Cannot delete the active checkpoint.");
				return;
			}
			const confirmed = window.confirm(
				`Delete checkpoint "${branchName}"? This will hide it from the list.`,
			);
			if (!confirmed) return;
			setPendingAction(branchId);
			const currentActiveId = activeBranchRow.id;
			try {
				await qb(lix)
					.updateTable("lix_branch")
					.set({ hidden: true })
					.where("id", "=", branchId)
					.execute();
				if (currentActiveId) {
					await lix.switchBranch({ branchId: currentActiveId });
				}
			} catch (error) {
				console.error("Failed to delete branch", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix, activeBranchRow.id],
	);

	const isBusy = pendingAction !== null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border-panel)] px-3">
				<div className="flex min-w-0 items-center gap-2">
					<HistoryIcon className="size-3.75 text-[var(--color-icon-tertiary)]" />
					<span className="truncate text-xs font-semibold text-[var(--color-text-secondary)]">
						Checkpoints
					</span>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-7 rounded-[7px] text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
					aria-label="Create checkpoint"
					data-attr="checkpoint-create"
					disabled={isBusy}
					onClick={() => {
						void handleCreateBranch();
					}}
				>
					{pendingAction === "create" ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Plus className="size-3.5" />
					)}
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-1.5">
				{branches.length === 0 ? (
					<div className="px-2 py-2 text-xs text-[var(--color-text-tertiary)]">
						No checkpoints available
					</div>
				) : (
					<div className="flex flex-col gap-0.5" role="list">
						{branches.map((branch) => {
							const isActive = branch.id === activeBranchRow.id;
							const isReviewing = checkpointDiff?.branchId === branch.id;
							const isRestoreDisabled = isActive;
							const isDeleteDisabled = isActive;
							const branchDisplayName = displayBranchName(branch.name);
							const isPending = pendingAction === branch.id;
							return (
								<div
									key={branch.id}
									role="listitem"
									data-selected={isReviewing ? "true" : undefined}
									className={clsx(
										"group flex min-w-0 items-center rounded-[7px] transition-colors",
										isReviewing
											? "bg-[var(--color-bg-selection-current)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-border-selection-current)]"
											: "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
									)}
								>
									<button
										type="button"
										data-attr="branch-diff"
										data-selected={isReviewing ? "true" : undefined}
										aria-current={isActive ? "true" : undefined}
										onClick={() => {
											void handleSelectBranch(branch.id);
										}}
										className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-l-[7px] px-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
									>
										<span className="flex size-3.5 shrink-0 items-center justify-center">
											{isPending ? (
												<Loader2 className="size-3 animate-spin text-[var(--color-icon-brand)]" />
											) : isReviewing ? (
												<HistoryIcon className="size-3 text-[var(--color-icon-brand)]" />
											) : null}
										</span>
										<span className="truncate">{branchDisplayName}</span>
									</button>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												type="button"
												className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-icon-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
												data-branch-actions
											>
												<span className="sr-only">
													Checkpoint actions for {branchDisplayName}
												</span>
												<MoreVertical className="size-3.5" aria-hidden="true" />
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="start"
											side="right"
											className="min-w-40 text-xs"
										>
											<DropdownMenuItem
												className="flex items-center gap-2 text-xs"
												data-attr="branch-switch"
												onSelect={() => {
													if (isRestoreDisabled) return;
													void handleSwitch(branch.id);
												}}
												disabled={isRestoreDisabled}
											>
												<RotateCcw className="size-3" />
												<span>Restore</span>
											</DropdownMenuItem>
											<DropdownMenuItem
												className="flex items-center gap-2 text-xs"
												data-attr="branch-rename"
												onSelect={(event) => {
													event.preventDefault();
													void handleRenameBranch(branch.id, branchDisplayName);
												}}
											>
												<PenLine className="size-3" />
												<span>Rename checkpoint</span>
											</DropdownMenuItem>
											<DropdownMenuItem
												className="flex items-center gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:!text-destructive"
												data-attr="branch-delete"
												onSelect={() => {
													if (isDeleteDisabled) return;
													void handleDeleteBranch(branch.id, branchDisplayName);
												}}
												disabled={isDeleteDisabled}
											>
												<Trash2 className="size-3" />
												<span>Delete checkpoint</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

async function generateCheckpointName(args: {
	readonly diffContext?: string;
}): Promise<GeneratedCheckpointName> {
	const desktop = window.flashtypeDesktop;
	const terminal = desktop?.terminal;
	if (desktop?.lix && terminal?.generateCheckpointName) {
		try {
			const cwd = await desktop.lix.workspaceDir();
			const result = await terminal.generateCheckpointName({
				cwd,
				diffContext: args.diffContext,
			});
			const name = result.name.trim();
			if (name) {
				return { name, source: result.source };
			}
		} catch (error) {
			console.warn("Failed to generate checkpoint name", error);
		}
	}
	return { name: formatLocalTimestamp(), source: "timestamp" };
}

async function buildCheckpointNameDiffContextForBranch(
	lix: ReturnType<typeof useLix>,
	branchId: string,
): Promise<string> {
	try {
		const branches = await loadVisibleCheckpointBranches(lix);
		const diff = await resolveCheckpointDiff({ lix, branches, branchId });
		return buildCheckpointNameDiffContext(diff);
	} catch (error) {
		console.warn("Failed to build checkpoint name diff context", error);
		return buildCheckpointNameDiffContext(null);
	}
}

async function loadVisibleCheckpointBranches(
	lix: ReturnType<typeof useLix>,
): Promise<CheckpointDiffBranchRow[]> {
	return (await qb(lix)
		.selectFrom("lix_branch")
		.select(["id", "name", "commit_id"])
		.where(
			() =>
				sql`COALESCE(CAST(lix_branch.hidden AS TEXT), 'false') NOT IN ('true', '1', 't')`,
		)
		.orderBy("name", "asc")
		.execute()) as CheckpointDiffBranchRow[];
}

export function buildCheckpointNameDiffContext(
	diff: CheckpointDiff | null | undefined,
): string {
	if (!diff || diff.files.length === 0) {
		return "No file changes were detected.";
	}

	const lines = [
		`Checkpoint diff: ${displayBranchName(diff.beforeBranchName)} -> ${displayBranchName(diff.branchName)}`,
		`Files changed: ${diff.files.length} (${formatStatusCounts(diff.files)})`,
	];
	const files = diff.files.slice(0, MAX_CHECKPOINT_DIFF_CONTEXT_FILES);
	for (const file of files) {
		lines.push("", ...summarizeCheckpointDiffFile(file));
	}
	if (diff.files.length > files.length) {
		lines.push("", `${diff.files.length - files.length} more files omitted.`);
	}

	const context = lines.join("\n");
	if (context.length <= MAX_CHECKPOINT_DIFF_CONTEXT_LENGTH) {
		return context;
	}
	return `${context.slice(0, MAX_CHECKPOINT_DIFF_CONTEXT_LENGTH).trimEnd()}\n[diff context truncated]`;
}

function formatStatusCounts(files: readonly CheckpointDiffFile[]): string {
	const counts = new Map<CheckpointDiffFile["status"], number>();
	for (const file of files) {
		counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([status, count]) => `${count} ${status}`)
		.join(", ");
}

function summarizeCheckpointDiffFile(file: CheckpointDiffFile): string[] {
	const beforeText = decodeUtf8ForCheckpointSummary(file.beforeData);
	const afterText = decodeUtf8ForCheckpointSummary(file.afterData);
	const lines = [
		`File: ${file.status} ${formatCheckpointDiffPath(file)}`,
		`Bytes: ${file.beforeData.byteLength} -> ${file.afterData.byteLength}`,
	];
	if (beforeText === null || afterText === null) {
		lines.push("Content: binary or non-UTF-8; text excerpt unavailable.");
		return lines;
	}

	const beforeLines = splitCheckpointSummaryLines(beforeText);
	const afterLines = splitCheckpointSummaryLines(afterText);
	lines.push(`Lines: ${beforeLines.length} -> ${afterLines.length}`);
	if (file.status === "added") {
		lines.push(...formatCheckpointSnippet("Added excerpt", afterLines));
		return lines;
	}
	if (file.status === "deleted") {
		lines.push(...formatCheckpointSnippet("Deleted excerpt", beforeLines));
		return lines;
	}

	const changed = checkpointChangedLineWindow(beforeLines, afterLines);
	if (changed.before.length === 0 && changed.after.length === 0) {
		lines.push("Content: unchanged; path or file identity changed.");
		return lines;
	}
	lines.push(...formatCheckpointSnippet("Before excerpt", changed.before));
	lines.push(...formatCheckpointSnippet("After excerpt", changed.after));
	return lines;
}

function formatCheckpointDiffPath(file: CheckpointDiffFile): string {
	if (
		file.beforePath &&
		file.afterPath &&
		file.beforePath !== file.afterPath
	) {
		return `${file.beforePath} -> ${file.afterPath}`;
	}
	return file.path;
}

function decodeUtf8ForCheckpointSummary(data: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(data);
	} catch {
		return null;
	}
}

function splitCheckpointSummaryLines(text: string): string[] {
	if (text.length === 0) return [];
	return text.replace(/\r\n?/gu, "\n").split("\n");
}

function checkpointChangedLineWindow(
	beforeLines: readonly string[],
	afterLines: readonly string[],
): {
	readonly before: readonly string[];
	readonly after: readonly string[];
} {
	let prefix = 0;
	while (
		prefix < beforeLines.length &&
		prefix < afterLines.length &&
		beforeLines[prefix] === afterLines[prefix]
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix + prefix < beforeLines.length &&
		suffix + prefix < afterLines.length &&
		beforeLines[beforeLines.length - 1 - suffix] ===
			afterLines[afterLines.length - 1 - suffix]
	) {
		suffix += 1;
	}
	return {
		before: beforeLines.slice(prefix, beforeLines.length - suffix),
		after: afterLines.slice(prefix, afterLines.length - suffix),
	};
}

function formatCheckpointSnippet(
	label: string,
	lines: readonly string[],
): string[] {
	if (lines.length === 0) {
		return [`${label}: <none>`];
	}
	const preview = lines.slice(0, MAX_CHECKPOINT_DIFF_SNIPPET_LINES);
	const formatted = [
		`${label}${lines.length > preview.length ? ` (${preview.length} of ${lines.length} changed lines)` : ""}:`,
		...preview.map(
			(line) =>
				`  ${truncateCheckpointSnippetLine(line) || "<blank line>"}`,
		),
	];
	return formatted;
}

function truncateCheckpointSnippetLine(line: string): string {
	if (line.length <= MAX_CHECKPOINT_DIFF_SNIPPET_LINE_LENGTH) {
		return line;
	}
	return `${line.slice(0, MAX_CHECKPOINT_DIFF_SNIPPET_LINE_LENGTH).trimEnd()}...`;
}

function formatLocalTimestamp(date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return [
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
	].join(" ");
}

export const extension = createReactExtensionDefinition({
	kind: HISTORY_EXTENSION_KIND,
	label: "History",
	description: "Review and restore checkpoints.",
	icon: HistoryIcon,
	component: ({ context }) => (
		<LixProvider lix={context.lix}>
			<HistoryView
				checkpointDiff={context.checkpointDiff}
				showCheckpointDiff={context.showCheckpointDiff}
				clearCheckpointDiff={context.clearCheckpointDiff}
			/>
		</LixProvider>
	),
});
