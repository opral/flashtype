import { useCallback, useState } from "react";
import { qb, sql } from "@/lib/lix-kysely";
import { useLix, useQuery, useQueryTakeFirstOrThrow } from "@/lib/lix-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Check,
	ChevronDown,
	GitBranch,
	Loader2,
	MoreVertical,
	PenLine,
	Plus,
	Trash2,
} from "lucide-react";
import clsx from "clsx";

type BranchRow = {
	id: string;
	name: string;
	hidden: boolean | null;
	commit_id: string | null;
};

/**
 * Dropdown trigger that lists available branches and switches the active one.
 *
 * Branches are queried reactively from the underlying Lix store. Selecting
 * another branch updates the workspace branch via `lix.switchBranch`, which
 * in turn refreshes any subscribers (e.g. editors watching the active branch).
 *
 * @example
 * <BranchSwitcher />
 */
export function BranchSwitcher() {
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

	return <BranchSwitcherWithActiveBranch lix={lix} branches={branches} />;
}

function BranchSwitcherWithActiveBranch({
	lix,
	branches,
}: {
	readonly lix: ReturnType<typeof useLix>;
	readonly branches: BranchRow[];
}) {
	const activeBranch = useQueryTakeFirstOrThrow<{ value: string }>(() =>
		qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select(["value"]),
	);
	return (
		<BranchSwitcherContent
			lix={lix}
			branches={branches}
			activeBranchId={activeBranch.value}
		/>
	);
}

function BranchSwitcherContent({
	lix,
	branches,
	activeBranchId,
}: {
	readonly lix: ReturnType<typeof useLix>;
	readonly branches: BranchRow[];
	readonly activeBranchId: string;
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
	const [menuOpen, setMenuOpen] = useState(false);

	const handleSwitch = useCallback(
		async (branchId: string) => {
			if (!lix || branchId === activeBranchRow.id) return;
			setPendingAction(branchId);
			try {
				await lix.switchBranch({ branchId });
			} catch (error) {
				console.error("Failed to switch branch", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix, activeBranchRow.id],
	);

	const handleCreateBranch = useCallback(async () => {
		if (!lix) return;
		const suggestion = `draft-${branches.length + 1}`;
		const entered = window.prompt("Name the new branch", suggestion);
		if (entered === null) return;
		const trimmed = entered.trim();
		setPendingAction("create");
		try {
			const created = await lix.createBranch({
				name: trimmed.length > 0 ? trimmed : suggestion,
			});
			await lix.switchBranch({ branchId: created.id });
		} catch (error) {
			console.error("Failed to create branch", error);
		} finally {
			setPendingAction(null);
		}
	}, [lix, branches.length]);

	const handleRenameBranch = useCallback(
		async (branchId: string, currentName: string) => {
			const entered = window.prompt("Rename branch", currentName);
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
				window.alert("Cannot delete the active branch.");
				return;
			}
			const confirmed = window.confirm(
				`Delete branch "${branchName}"? This will hide it from the list.`,
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
				setMenuOpen(false);
			} catch (error) {
				console.error("Failed to delete branch", error);
			} finally {
				setPendingAction(null);
			}
		},
		[lix, activeBranchRow.id],
	);

	const buttonLabel = `${activeBranchRow.name}`;
	const isBusy = pendingAction !== null;

	return (
		<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="inline-flex h-5.5 items-center gap-1 rounded-md px-1.5 font-normal text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]"
					aria-label="Select branch"
				>
					<GitBranch className="size-3" />
					<span className="text-[11.5px]">{buttonLabel}</span>
					{isBusy ? (
						<Loader2 className="size-2.5 animate-spin" />
					) : (
						<ChevronDown className="size-2.5" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="min-w-45 text-xs"
				align="start"
				sideOffset={6}
			>
				<DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-[var(--color-text-tertiary)]">
					Branches
				</DropdownMenuLabel>
				{branches.length === 0 ? (
					<div className="px-3 py-2 text-muted-foreground">
						No branches available
					</div>
				) : (
					branches.map((branch) => {
						const isActive = branch.id === activeBranchRow.id;
						const isDeleteDisabled = isActive;
						const branchLabelId = `branch-switcher-label-${branch.id}`;
						return (
							<DropdownMenuItem
								key={branch.id}
								aria-labelledby={branchLabelId}
								data-attr="branch-switch"
								onSelect={(event) => {
									type DropdownSelectEvent = Event & {
										detail?: { originalEvent?: Event };
									};
									const originalTarget = (event as DropdownSelectEvent).detail
										?.originalEvent?.target as HTMLElement | undefined;
									if (originalTarget?.closest("[data-branch-actions]")) {
										event.preventDefault();
										return;
									}
									void handleSwitch(branch.id);
								}}
								className={clsx(
									"group flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs",
									isActive
										? "text-[var(--color-text-primary)]"
										: "text-[var(--color-text-secondary)]",
								)}
							>
								<span className="flex w-3 justify-center" aria-hidden>
									{isActive ? (
										<Check className="h-3 w-3 text-[var(--color-icon-brand)]" />
									) : null}
								</span>
								<span id={branchLabelId} className="truncate">
									{branch.name}
								</span>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											className="ml-auto flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
											data-branch-actions
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
											}}
										>
											<span className="sr-only">
												Branch actions for {branch.name}
											</span>
											<MoreVertical
												className="h-3.5 w-3.5 text-[var(--color-icon-tertiary)]"
												aria-hidden="true"
											/>
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										side="right"
										className="min-w-40 text-xs"
									>
										<DropdownMenuItem
											className="flex items-center gap-2 text-xs"
											data-attr="branch-rename"
											onSelect={(event) => {
												event.preventDefault();
												void handleRenameBranch(branch.id, branch.name);
											}}
										>
											<PenLine className="h-3 w-3" />
											<span>Rename</span>
										</DropdownMenuItem>
										<DropdownMenuItem
											className="flex items-center gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:!text-destructive"
											data-attr="branch-delete"
											onSelect={() => {
												if (isDeleteDisabled) return;
												void handleDeleteBranch(branch.id, branch.name);
											}}
											disabled={isDeleteDisabled}
										>
											<Trash2 className="h-3 w-3" />
											<span>Delete</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</DropdownMenuItem>
						);
					})
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={handleCreateBranch}
					className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--color-text-secondary)]"
				>
					<Plus className="h-3 w-3" />
					<span>Create branch</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
