import { act } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AtelierExtensionRuntime } from "@opral/atelier";

const historyViewMock = vi.hoisted(() =>
	vi.fn((_props: Record<string, unknown>) => null),
);
vi.mock("./index", () => ({ HistoryView: historyViewMock }));

import { createHistoryExtensionRegistration } from "./host-extension";

describe("createHistoryExtensionRegistration", () => {
	afterEach(() => {
		document.body.replaceChildren();
		vi.clearAllMocks();
	});

	test("registers and disposes the FlashType-owned history view", async () => {
		const registration = createHistoryExtensionRegistration();
		const element = document.createElement("div");
		document.body.append(element);
		const controller = new AbortController();
		const show = vi.fn(async () => null);
		const clear = vi.fn();
		const atelier = {
			lix: {},
			revisions: { current: null, show, clear },
		} as unknown as AtelierExtensionRuntime;

		let mounted: ReturnType<typeof registration.entry.mount>;
		await act(async () => {
			mounted = registration.entry.mount({
				element,
				atelier,
				view: {
					instanceId: "flashtype-history-1",
					state: {},
					panel: "left",
					isActive: true,
					isFocused: true,
					registerNewFileDraftHandler: () => () => {},
				},
				signal: controller.signal,
			});
		});

		expect(registration.manifest.id).toBe("atelier_history");
		expect(registration.manifest.name).toBe("History");
		expect(historyViewMock).toHaveBeenCalledOnce();
		expect(historyViewMock.mock.calls.at(-1)?.[0]).toEqual(
			expect.objectContaining({
				currentRevision: null,
				showCheckpointDiff: show,
				clearCheckpointDiff: clear,
			}),
		);

		await act(async () => {
			mounted?.dispose?.();
		});
	});
});
