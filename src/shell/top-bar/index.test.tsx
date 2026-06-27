import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TopBar } from ".";

describe("TopBar", () => {
	test("renders stable analytics selectors for chrome controls", () => {
		render(
			<TopBar
				workspaceName="Workspace"
				onWorkspaceTitleClick={vi.fn()}
				onToggleLeftSidebar={vi.fn()}
				onToggleRightSidebar={vi.fn()}
				isUpdateReady={true}
				onInstallUpdate={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText("Toggle left panel")).toHaveAttribute(
			"data-attr",
			"topbar-toggle-left-panel",
		);
		expect(screen.getByTitle("Switch workspace")).toHaveAttribute(
			"data-attr",
			"workspace-switch",
		);
		expect(screen.getByLabelText("Install update")).toHaveAttribute(
			"data-attr",
			"update-install",
		);
		expect(screen.getByTitle("GitHub")).toHaveAttribute(
			"data-attr",
			"github-open",
		);
		expect(screen.getByLabelText("Toggle right panel")).toHaveAttribute(
			"data-attr",
			"topbar-toggle-right-panel",
		);
	});
});
