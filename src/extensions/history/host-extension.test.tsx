import { act, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type {
	AtelierExtensionRuntime,
	AtelierMountedExtension,
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
	test(`composes History with temporary=${temporary} and forwards runtime updates`, async () => {
		const element = document.createElement("div");
		document.body.append(element);
		const runtime = { diff: { autoAccept: false } } as AtelierExtensionRuntime;
		const registration = createHistoryExtension(temporary);
		let mounted: AtelierMountedExtension | void;
		const args = {
			element,
			atelier: runtime,
			signal: new AbortController().signal,
			view: {} as Parameters<typeof registration.entry.mount>[0]["view"],
		};
		try {
			await act(async () => {
				mounted = registration.entry.mount(args);
			});
			expect(screen.getByTestId("timeline")).toHaveTextContent("false");
			expect(
				screen.queryByRole("button", { name: "Initialize repository" }) !==
					null,
			).toBe(temporary);
			await act(async () => {
				mounted?.update?.({
					...args,
					atelier: { ...runtime, diff: { ...runtime.diff!, autoAccept: true } },
				});
			});
			expect(screen.getByTestId("timeline")).toHaveTextContent("true");
		} finally {
			await act(async () => mounted?.dispose?.());
			expect(element.childElementCount).toBe(0);
			element.remove();
		}
	});
}
