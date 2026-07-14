import { Suspense, type ComponentProps } from "react";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { HistoryView } from ".";

const originalDesktop = window.flashtypeDesktop;
const TIMESTAMP_CHECKPOINT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;

function selectedCheckpointButtons(): HTMLButtonElement[] {
	return [
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-attr="branch-diff"][data-selected="true"]',
		),
	];
}

async function writeLixFile(
	lix: Lix,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, data: new TextEncoder().encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({
				path,
				data: new TextEncoder().encode(text),
			}),
		)
		.execute();
}

describe("HistoryView", () => {
	let lix: Lix;
	let cleanupFns: Array<() => Promise<void>> = [];

	const renderWithProviders = async (
		props: ComponentProps<typeof HistoryView> = {},
	) => {
		await act(async () => {
			render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView {...props} />
					</Suspense>
				</LixProvider>,
			);
		});
	};

	beforeEach(async () => {
		lix = await openLix({});
		cleanupFns.push(() => lix.close());

		const activeBranchId = await lix.activeBranchId();

		await qb(lix)
			.updateTable("lix_branch")
			.set({ name: "main" })
			.where("id", "=", activeBranchId)
			.execute();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		window.flashtypeDesktop = originalDesktop;
		cleanup();

		for (const fn of cleanupFns.splice(0)) {
			await fn();
		}
	});

	test("renders main as the current checkpoint", async () => {
		await renderWithProviders();

		const activeCheckpoint = await screen.findByRole("button", {
			name: "Current Checkpoint",
		});
		expect(activeCheckpoint).toHaveAttribute("aria-current", "true");
		expect(activeCheckpoint).not.toHaveAttribute("data-selected");
		expect(selectedCheckpointButtons()).toHaveLength(0);
	});

	test("clicking another branch without review mode does not restore it", async () => {
		const initialActiveBranchId = await lix.activeBranchId();
		const draftName = `draft-${Math.random().toString(36).slice(2, 7)}`;
		await lix.createBranch({ name: draftName });

		await renderWithProviders();

		const draftItem = await screen.findByRole("button", { name: draftName });
		expect(draftItem).toHaveAttribute("data-attr", "branch-diff");
		expect(draftItem).not.toHaveAttribute("aria-current");

		await act(async () => {
			fireEvent.click(draftItem);
		});

		expect(draftItem).not.toHaveAttribute("data-selected");
		expect(draftItem).not.toHaveAttribute("aria-current");
		expect(selectedCheckpointButtons()).toHaveLength(0);

		const active = await qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select("value")
			.executeTakeFirstOrThrow();
		expect(active.value).toBe(initialActiveBranchId);
	});

	test("passes the selected branch id to the revision API", async () => {
		const branchB = await lix.createBranch({ name: "b-checkpoint" });
		await lix.createBranch({ name: "a-checkpoint" });
		const showCheckpointDiff = vi.fn().mockResolvedValue(undefined);

		await renderWithProviders({ showCheckpointDiff });

		const checkpoint = await screen.findByRole("button", {
			name: "b-checkpoint",
		});
		await act(async () => {
			fireEvent.click(checkpoint);
		});

		expect(showCheckpointDiff).toHaveBeenCalledTimes(1);
		expect(showCheckpointDiff).toHaveBeenCalledWith(branchB.id);
		expect(checkpoint).not.toHaveAttribute("data-selected");
		expect(selectedCheckpointButtons()).toHaveLength(0);
	});

	test("clicking the active checkpoint diff again clears it", async () => {
		const target = await lix.createBranch({ name: "selected-checkpoint" });
		const clearCheckpointDiff = vi.fn();

		await renderWithProviders({
			currentRevision: { branchId: target.id },
			clearCheckpointDiff,
		});

		const checkpoint = await screen.findByRole("button", {
			name: "selected-checkpoint",
		});
		const currentCheckpoint = await screen.findByRole("button", {
			name: "Current Checkpoint",
		});
		await waitFor(() => {
			expect(checkpoint).toHaveAttribute("data-selected", "true");
		});
		expect(checkpoint).not.toHaveAttribute("aria-current");
		expect(currentCheckpoint).toHaveAttribute("aria-current", "true");
		expect(currentCheckpoint).not.toHaveAttribute("data-selected");

		await act(async () => {
			fireEvent.click(checkpoint);
		});

		expect(clearCheckpointDiff).toHaveBeenCalledTimes(1);
	});

	test("restores another branch via actions menu", async () => {
		const draftName = `draft-${Math.random().toString(36).slice(2, 7)}`;
		const newBranch = await lix.createBranch({ name: draftName });

		await renderWithProviders();

		const actionsButton = await screen.findByRole("button", {
			name: `Checkpoint actions for ${draftName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const restoreItem = await screen.findByRole("menuitem", {
			name: "Restore",
		});
		expect(restoreItem).toHaveAttribute("data-attr", "branch-switch");
		await act(async () => {
			fireEvent.click(restoreItem);
		});

		const draftItem = await screen.findByRole("button", { name: draftName });
		await waitFor(() => {
			expect(draftItem).toHaveAttribute("aria-current", "true");
		});

		await waitFor(async () => {
			const active = await qb(lix)
				.selectFrom("lix_key_value")
				.where("key", "=", "lix_workspace_branch_id")
				.select("value")
				.executeTakeFirstOrThrow();
			expect(active.value).toBe(newBranch.id);
		});
	});

	test("creates a timestamp branch and prefixes generated names after a delay", async () => {
		const initialActiveBranchId = await lix.activeBranchId();
		const branchCreateCalls: string[] = [];
		const originalCreateBranch = lix.createBranch.bind(lix);
		const syncDiskToLix = vi
			.spyOn(lix, "syncDiskToLix")
			.mockImplementation(async () => {
				branchCreateCalls.push("sync");
			});
		const createBranch = vi
			.spyOn(lix, "createBranch")
			.mockImplementation(async (options) => {
				branchCreateCalls.push("create");
				return await originalCreateBranch(options);
			});
		const workspaceDir = vi.fn().mockResolvedValue("/tmp/flashtype-workspace");
		const generateCheckpointName = vi.fn().mockResolvedValue({
			name: "Update onboarding copy",
			source: "codex",
		});
		window.flashtypeDesktop = {
			lix: {
				workspaceDir,
			},
			terminal: {
				generateCheckpointName,
			},
		} as unknown as Window["flashtypeDesktop"];
		await writeLixFile(
			lix,
			"file_onboarding",
			"/onboarding.md",
			"# Onboarding\nWelcome to the updated flow.\n",
		);

		await renderWithProviders();
		const createButton = await screen.findByRole("button", {
			name: "Create checkpoint",
		});
		const realSetTimeout = globalThis.setTimeout.bind(globalThis);
		let runScheduledRename: (() => void) | null = null;
		const setTimeoutSpy = vi
			.spyOn(window, "setTimeout")
			.mockImplementation((handler, timeout, ...args) => {
				if (timeout === 5000 && typeof handler === "function") {
					runScheduledRename = () => {
						handler(...args);
					};
					const timerId = realSetTimeout(() => undefined, 0);
					globalThis.clearTimeout(timerId);
					return timerId;
				}
				return realSetTimeout(handler, timeout, ...args);
			});
		await act(async () => {
			fireEvent.click(createButton);
		});

		let created: { id: string; name: string } | undefined;
		await waitFor(() => {
			expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
		});
		await waitFor(async () => {
			const branches = await qb(lix)
				.selectFrom("lix_branch")
				.select(["id", "name"])
				.execute();
			created = branches.find((branch) =>
				TIMESTAMP_CHECKPOINT_PATTERN.test(branch.name),
			);
			expect(created).toBeDefined();
		});

		expect(
			screen.getByRole("button", { name: "Current Checkpoint" }),
		).toHaveAttribute("aria-current", "true");
		expect(syncDiskToLix).toHaveBeenCalledTimes(1);
		expect(createBranch).toHaveBeenCalledTimes(1);
		expect(branchCreateCalls).toEqual(["sync", "create"]);
		expect(
			await screen.findByRole("button", { name: "Naming checkpoint..." }),
		).toBeInTheDocument();

		const active = await qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select("value")
			.executeTakeFirstOrThrow();
		expect(active.value).toBe(initialActiveBranchId);

		await act(async () => {
			runScheduledRename?.();
		});

		await waitFor(async () => {
			const renamed = await qb(lix)
				.selectFrom("lix_branch")
				.select("name")
				.where("id", "=", created?.id ?? "")
				.executeTakeFirstOrThrow();
			expect(renamed.name).toBe(`${created?.name}:Update onboarding copy`);
		});
		expect(workspaceDir).toHaveBeenCalled();
		expect(generateCheckpointName).toHaveBeenCalledWith({
			cwd: "/tmp/flashtype-workspace",
			diffContext: expect.stringContaining("/onboarding.md"),
		});
		const diffContext = generateCheckpointName.mock.calls[0]?.[0]?.diffContext;
		expect(diffContext).toContain("File: added /onboarding.md");
		expect(diffContext).toContain("Added excerpt");
		expect(diffContext).toContain("Welcome to the updated flow.");
		expect(
			await screen.findByRole("button", { name: "Update onboarding copy" }),
		).toBeInTheDocument();
	});

	test("falls back to a local timestamp checkpoint name without the desktop bridge", async () => {
		window.flashtypeDesktop = undefined;
		vi.spyOn(lix, "syncDiskToLix").mockResolvedValue();

		await renderWithProviders();
		const createButton = await screen.findByRole("button", {
			name: "Create checkpoint",
		});
		const realSetTimeout = globalThis.setTimeout.bind(globalThis);
		let runScheduledRename: (() => void) | null = null;
		vi.spyOn(window, "setTimeout").mockImplementation(
			(handler, timeout, ...args) => {
				if (timeout === 5000 && typeof handler === "function") {
					runScheduledRename = () => {
						handler(...args);
					};
					const timerId = realSetTimeout(() => undefined, 0);
					globalThis.clearTimeout(timerId);
					return timerId;
				}
				return realSetTimeout(handler, timeout, ...args);
			},
		);
		await act(async () => {
			fireEvent.click(createButton);
		});

		let created: { id: string; name: string } | undefined;
		await waitFor(async () => {
			const branches = await qb(lix)
				.selectFrom("lix_branch")
				.select(["id", "name"])
				.execute();
			created = branches.find((branch) =>
				TIMESTAMP_CHECKPOINT_PATTERN.test(branch.name),
			);
			expect(created).toBeDefined();
		});
		expect(
			await screen.findByRole("button", { name: "Naming checkpoint..." }),
		).toBeInTheDocument();

		await act(async () => {
			runScheduledRename?.();
		});

		await waitFor(async () => {
			const renamed = await qb(lix)
				.selectFrom("lix_branch")
				.select("name")
				.where("id", "=", created?.id ?? "")
				.executeTakeFirstOrThrow();
			expect(renamed.name).toBe(created?.name);
		});
	});

	test("renames a branch via actions menu", async () => {
		const baseName = `docs-${Math.random().toString(36).slice(2, 7)}`;
		const renamedName = `${baseName}-renamed`;
		const target = await lix.createBranch({ name: baseName });
		const promptSpy = vi.fn().mockReturnValue(renamedName);
		vi.stubGlobal("prompt", promptSpy);

		await renderWithProviders();

		const actionsButton = await screen.findByRole("button", {
			name: `Checkpoint actions for ${baseName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const renameItem = await screen.findByRole("menuitem", {
			name: "Rename checkpoint",
		});
		expect(renameItem).toHaveAttribute("data-attr", "branch-rename");
		await act(async () => {
			fireEvent.click(renameItem);
		});

		expect(promptSpy).toHaveBeenCalledWith("Rename checkpoint", baseName);
		await waitFor(() => {
			expect(screen.getByText(renamedName)).toBeInTheDocument();
		});

		const row = await qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name"])
			.where("id", "=", target.id)
			.executeTakeFirstOrThrow();
		expect(row.name).toBe(renamedName);
	});

	test("deletes a branch via actions menu", async () => {
		const tempName = `temp-${Math.random().toString(36).slice(2, 7)}`;
		const target = await lix.createBranch({ name: tempName });
		const confirmSpy = vi.fn().mockReturnValue(true);
		vi.stubGlobal("confirm", confirmSpy);

		await renderWithProviders();

		const actionsButton = await screen.findByRole("button", {
			name: `Checkpoint actions for ${tempName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const deleteItem = await screen.findByRole("menuitem", {
			name: "Delete checkpoint",
		});
		expect(deleteItem).toHaveAttribute("data-attr", "branch-delete");
		await act(async () => {
			fireEvent.click(deleteItem);
		});

		expect(confirmSpy).toHaveBeenCalledWith(
			`Delete checkpoint "${tempName}"? This will hide it from the list.`,
		);
		await waitFor(() => {
			expect(
				screen.queryByRole("button", { name: tempName }),
			).not.toBeInTheDocument();
		});

		const row = await qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "hidden"])
			.where("id", "=", target.id)
			.executeTakeFirstOrThrow();
		expect(row.hidden).toBeTruthy();

		const activeBranchId = await lix.activeBranchId();
		expect(activeBranchId).not.toBe(target.id);

		confirmSpy.mockRestore();
	});

	test("delete action is disabled for active branch", async () => {
		await renderWithProviders();

		const actionsButton = await screen.findByRole("button", {
			name: "Checkpoint actions for Current Checkpoint",
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const deleteItem = await screen.findByRole("menuitem", {
			name: "Delete checkpoint",
		});
		expect(deleteItem).toHaveAttribute("data-disabled");
	});

	test("restore action is disabled for active branch", async () => {
		await renderWithProviders();

		const actionsButton = await screen.findByRole("button", {
			name: "Checkpoint actions for Current Checkpoint",
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const restoreItem = await screen.findByRole("menuitem", {
			name: "Restore",
		});
		expect(restoreItem).toHaveAttribute("data-disabled");
	});
});
