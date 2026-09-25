import { render, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
	AtelierExtensionRuntime,
	AtelierExtensionView,
} from "@opral/atelier";
import {
	agentDiffBridge,
	FLASHTYPE_ATELIER_EXTENSIONS,
} from "./host-extensions";
vi.mock("./index", () => ({ TerminalView: () => null }));
afterEach(cleanup);
test("agent turns open an applied review scoped to that turn", async () => {
	const open = vi.fn().mockResolvedValue(undefined);
	const Component = FLASHTYPE_ATELIER_EXTENSIONS[0]!.Component;
	render(
		<Component
			atelier={{ diff: { open } } as unknown as AtelierExtensionRuntime}
			view={{} as AtelierExtensionView}
			data={null}
		/>,
	);
	await agentDiffBridge.open({
		beforeCommitId: "before-agent-turn",
		afterCommitId: "after-agent-turn",
	});
	expect(open).toHaveBeenCalledWith({
		base: { commitId: "before-agent-turn" },
		target: { commitId: "after-agent-turn" },
		intent: "review-applied",
		reveal: true,
	});
});

test("keeps the shared review runtime while another agent view remains mounted", async () => {
	const open = vi.fn().mockResolvedValue(undefined);
	const atelier = { diff: { open } } as unknown as AtelierExtensionRuntime;
	const view = {} as AtelierExtensionView;
	const ClaudeComponent = FLASHTYPE_ATELIER_EXTENSIONS[0]!.Component;
	const CodexComponent = FLASHTYPE_ATELIER_EXTENSIONS[1]!.Component;
	const claude = render(
		<ClaudeComponent atelier={atelier} view={view} data={null} />,
	);
	render(<CodexComponent atelier={atelier} view={view} data={null} />);

	claude.unmount();
	await agentDiffBridge.open({
		beforeCommitId: "before-agent-turn",
		afterCommitId: "after-agent-turn",
	});

	expect(open).toHaveBeenCalledWith({
		base: { commitId: "before-agent-turn" },
		target: { commitId: "after-agent-turn" },
		intent: "review-applied",
		reveal: true,
	});
});

test("agent terminals support every area", () => {
 for (const extension of FLASHTYPE_ATELIER_EXTENSIONS) expect(extension.placement).toEqual(["left", "main", "right"]);
});
