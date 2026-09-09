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
test("agent turns request Keep / Undo for their exact applied span", async () => {
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
		beforeCommitId: "before",
		afterCommitId: "after",
	});
	expect(open).toHaveBeenCalledWith({
		base: { commitId: "before" },
		target: { commitId: "after" },
		intent: "review-applied",
		reveal: true,
	});
});
