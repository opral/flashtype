import React, { Suspense } from "react";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { BranchSwitcher } from "./branch-switcher";

describe("BranchSwitcher disabled", () => {
	test("renders a disabled control without a Lix provider", () => {
		render(<BranchSwitcher disabled />);

		const trigger = screen.getByRole("button", { name: "Select branch" });
		expect(trigger).toBeDisabled();
		expect(trigger).toHaveTextContent("No branch");
		expect(trigger).toHaveAttribute("data-attr", "branch-switcher-disabled");
		expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
	});
});

describe("BranchSwitcher", () => {
	let lix: Lix;
	let cleanupFns: Array<() => Promise<void>> = [];

	const renderWithProviders = async () => {
		await act(async () => {
			render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<BranchSwitcher />
					</Suspense>
				</LixProvider>,
			);
		});
	};

	const openBranchMenu = async () => {
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		await act(async () => {
			fireEvent.pointerDown(trigger, { button: 0 });
			fireEvent.pointerUp(trigger, { button: 0 });
		});
		return trigger;
	};

	const branchCount = async () => {
		const rows = await qb(lix).selectFrom("lix_branch").select("id").execute();
		return rows.length;
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

		for (const fn of cleanupFns.splice(0)) {
			await fn();
		}
	});

	test("renders the active branch name", async () => {
		await renderWithProviders();

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});
		expect(trigger).toHaveTextContent("main");
	});

	test("switches to another branch when selected", async () => {
		const draftName = `draft-${Math.random().toString(36).slice(2, 7)}`;
		const newBranch = await lix.createBranch({ name: draftName });

		await renderWithProviders();

		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger, { button: 0 });
			fireEvent.pointerUp(trigger, { button: 0 });
		});

		const draftItem = await screen.findByRole("menuitem", { name: draftName });
		expect(draftItem).toHaveAttribute("data-attr", "branch-switch");

		await act(async () => {
			fireEvent.click(draftItem);
		});

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Select branch" }),
			).toHaveTextContent(draftName);
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

	test("creates a branch from the menu and switches to it", async () => {
		const branchName = `feature-${Math.random().toString(36).slice(2, 7)}`;

		await renderWithProviders();
		await openBranchMenu();

		const createItem = await screen.findByRole("menuitem", {
			name: "Create branch",
		});
		await act(async () => {
			fireEvent.click(createItem);
		});

		const input = await screen.findByRole("textbox", { name: "Branch name" });
		expect(input).toHaveValue("draft-2");
		await act(async () => {
			fireEvent.input(input, { target: { value: ` ${branchName} ` } });
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Select branch" }),
			).toHaveTextContent(branchName);
		});

		const created = await qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name"])
			.where("name", "=", branchName)
			.executeTakeFirstOrThrow();
		expect(created.name).toBe(branchName);

		const active = await qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select("value")
			.executeTakeFirstOrThrow();
		expect(active.value).toBe(created.id);
	});

	test("uses the suggested branch name when create prompt is blank", async () => {
		await renderWithProviders();
		await openBranchMenu();

		const createItem = await screen.findByRole("menuitem", {
			name: "Create branch",
		});
		await act(async () => {
			fireEvent.click(createItem);
		});

		const input = await screen.findByRole("textbox", { name: "Branch name" });
		expect(input).toHaveValue("draft-2");
		await act(async () => {
			fireEvent.input(input, { target: { value: "   " } });
			fireEvent.keyDown(input, { key: "Enter" });
		});

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Select branch" }),
			).toHaveTextContent("draft-2");
		});

		const created = await qb(lix)
			.selectFrom("lix_branch")
			.select(["id", "name"])
			.where("name", "=", "draft-2")
			.executeTakeFirstOrThrow();
		const active = await qb(lix)
			.selectFrom("lix_key_value")
			.where("key", "=", "lix_workspace_branch_id")
			.select("value")
			.executeTakeFirstOrThrow();
		expect(active.value).toBe(created.id);
	});

	test("does not create a branch when inline creation is cancelled", async () => {
		const initialCount = await branchCount();

		await renderWithProviders();
		await openBranchMenu();

		const createItem = await screen.findByRole("menuitem", {
			name: "Create branch",
		});
		await act(async () => {
			fireEvent.click(createItem);
		});

		const input = await screen.findByRole("textbox", { name: "Branch name" });
		await act(async () => {
			fireEvent.keyDown(input, { key: "Escape" });
		});

		expect(await branchCount()).toBe(initialCount);
		expect(
			screen.queryByRole("textbox", { name: "Branch name" }),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Select branch" }),
		).toHaveTextContent("main");
	});

	test("renames a branch via actions menu", async () => {
		const baseName = `docs-${Math.random().toString(36).slice(2, 7)}`;
		const renamedName = `${baseName}-renamed`;
		const target = await lix.createBranch({ name: baseName });
		const promptSpy = vi.fn().mockReturnValue(renamedName);
		vi.stubGlobal("prompt", promptSpy);

		await renderWithProviders();
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger);
			fireEvent.pointerUp(trigger);
		});

		const actionsButton = await screen.findByRole("button", {
			name: `Branch actions for ${baseName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const renameItem = await screen.findByRole("menuitem", { name: "Rename" });
		expect(renameItem).toHaveAttribute("data-attr", "branch-rename");
		await act(async () => {
			fireEvent.click(renameItem);
		});

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
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger);
			fireEvent.pointerUp(trigger);
		});

		const actionsButton = await screen.findByRole("button", {
			name: `Branch actions for ${tempName}`,
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
		expect(deleteItem).toHaveAttribute("data-attr", "branch-delete");
		await act(async () => {
			fireEvent.click(deleteItem);
		});

		const triggerAfterDelete = await screen.findByRole("button", {
			name: "Select branch",
		});
		await act(async () => {
			fireEvent.pointerDown(triggerAfterDelete);
			fireEvent.pointerUp(triggerAfterDelete);
		});

		await waitFor(() => {
			expect(
				screen.queryByRole("menuitem", { name: tempName }),
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
		const trigger = await screen.findByRole("button", {
			name: "Select branch",
		});

		await act(async () => {
			fireEvent.pointerDown(trigger);
			fireEvent.pointerUp(trigger);
		});

		const actionsButton = await screen.findByRole("button", {
			name: "Branch actions for main",
		});
		await act(async () => {
			fireEvent.pointerDown(actionsButton, { button: 0 });
			fireEvent.pointerUp(actionsButton, { button: 0 });
		});

		const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
		expect(deleteItem).toHaveAttribute("data-disabled");
	});
});
