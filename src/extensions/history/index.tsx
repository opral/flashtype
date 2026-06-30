import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
	Check,
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
	ShowCheckpointDiffArgs,
} from "../../extension-runtime/checkpoint-diff";

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
			checkpointDiff={props.checkpointDiff}
			showCheckpointDiff={props.showCheckpointDiff}
			clearCheckpointDiff={props.clearCheckpointDiff}
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
	const [selectedBranchId, setSelectedBranchId] = useState(activeBranchRow.id);
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

	useEffect(() => {
		if (
			checkpointDiff?.branchId &&
			branches.some((branch) => branch.id === checkpointDiff.branchId)
		) {
			setSelectedBranchId(checkpointDiff.branchId);
			return;
		}
		if (branches.some((branch) => branch.id === selectedBranchId)) {
			return;
		}
		setSelectedBranchId(activeBranchRow.id);
	}, [
		activeBranchRow.id,
		branches,
		checkpointDiff?.branchId,
		selectedBranchId,
	]);

	const handleSwitch = useCallback(
		async (branchId: string) => {
			if (!lix || branchId === activeBranchRow.id) return;
			setPendingAction(branchId);
			try {
				await lix.switchBranch({ branchId });
				setSelectedBranchId(branchId);
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
				setSelectedBranchId(activeBranchRow.id);
				return;
			}
			setSelectedBranchId(branchId);
			if (!showCheckpointDiff) return;
			setPendingAction(branchId);
			try {
				await showCheckpointDiff({ branchId, branches });
			} catch (error) {
				console.error("Failed to resolve checkpoint diff", error);
				clearCheckpointDiff?.();
			} finally {
				setPendingAction(null);
			}
		},
		[
			activeBranchRow.id,
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
				void generateCheckpointName()
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
							const isSelected = branch.id === selectedBranchId;
							const isRestoreDisabled = isActive;
							const isDeleteDisabled = isActive;
							const branchDisplayName = displayBranchName(branch.name);
							const isPending = pendingAction === branch.id;
							return (
								<div
									key={branch.id}
									role="listitem"
									data-selected={isSelected ? "true" : undefined}
									className={clsx(
										"group flex min-w-0 items-center rounded-[7px] transition-colors",
										isActive
											? "bg-[var(--color-bg-selection-current)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-border-selection-current)]"
											: isSelected
												? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-border-panel)]"
												: "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
									)}
								>
									<button
										type="button"
										data-attr="branch-diff"
										data-selected={isSelected ? "true" : undefined}
										aria-current={isActive ? "true" : undefined}
										onClick={() => {
											void handleSelectBranch(branch.id);
										}}
										className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-l-[7px] px-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
									>
										<span className="flex size-3.5 shrink-0 items-center justify-center">
											{isPending ? (
												<Loader2 className="size-3 animate-spin text-[var(--color-icon-brand)]" />
											) : isActive ? (
												<Check className="size-3 text-[var(--color-icon-brand)]" />
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

async function generateCheckpointName(): Promise<GeneratedCheckpointName> {
	const desktop = window.flashtypeDesktop;
	const terminal = desktop?.terminal;
	if (desktop?.lix && terminal?.generateCheckpointName) {
		try {
			const cwd = await desktop.lix.workspaceDir();
			const result = await terminal.generateCheckpointName({ cwd });
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
