import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type {
	AtelierExtensionRuntime,
	AtelierExtensionView,
} from "@opral/atelier";
import { createHistoryExtension } from "./host-extension";

vi.mock("@opral/atelier", () => ({
	ATELIER_BUILTIN_EXTENSION_IDS: { history: "atelier_history" },
	Atelier: {
		History: ({ atelier }: { atelier: { diff: { autoAccept: boolean } } }) => (
			<div data-testid="timeline">{String(atelier.diff.autoAccept)}</div>
		),
	},
}));

for (const temporary of [true, false]) {
	test(`composes History with temporary=${temporary} and forwards runtime updates`, () => {
		const runtime = { diff: { autoAccept: false } } as AtelierExtensionRuntime;
		const { Component } = createHistoryExtension(temporary);
		const view = {} as AtelierExtensionView;
		const rendered = render(
			<Component data={null} atelier={runtime} view={view} />,
		);
		expect(screen.getByTestId("timeline")).toHaveTextContent("false");
		expect(
			screen.queryByRole("button", { name: "Initialize repository" }) !== null,
		).toBe(temporary);
		rendered.rerender(
			<Component
				data={null}
				atelier={{ ...runtime, diff: { ...runtime.diff!, autoAccept: true } }}
				view={view}
			/>,
		);
		expect(screen.getByTestId("timeline")).toHaveTextContent("true");
		rendered.unmount();
	});
}
