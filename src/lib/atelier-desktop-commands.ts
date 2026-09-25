import type { AtelierLocation, AtelierSessionStateStore } from "@opral/atelier";
import type { Lix } from "./lix-types";

/** Host-owned menu commands drive Atelier through location and session state. */
export function createDesktopDocumentCommands({
	lix,
	store,
	navigate,
}: {
	lix: Lix;
	store: AtelierSessionStateStore;
	navigate: (location: AtelierLocation | undefined) => void;
}) {
	return {
		async open(path: string) {
			const state = store.getSnapshot();
			const panel = state?.areas.main;
			const existing = panel?.views.find((view) => {
				const viewState = view.state as { filePath?: string } | undefined;
				return viewState?.filePath === path;
			});
			// An external open can repeat the last requested location after the
			// user switched tabs internally. Activate the tab even when Atelier
			// deduplicates that unchanged location.
			if (state && panel && existing) {
				store.setSnapshot({
					...state,
					focusedArea: "main",
					areas: {
						...state.areas,
						main: { ...panel, activeInstance: existing.instance },
					},
				});
			}
			navigate({ path });
		},
		async startNew() {
			for (let index = 0; ; index++) {
				const path = index === 0 ? "/Untitled.md" : `/Untitled ${index}.md`;
				const result = await lix.execute(
					"INSERT INTO lix_file (path, content) VALUES ($1, $2) ON CONFLICT (path) DO NOTHING RETURNING id",
					[path, new Uint8Array()],
				);
				if (result.rows.length) {
					navigate({ path });
					return;
				}
			}
		},
		async closeActive() {
			const state = store.getSnapshot();
			if (!state) return;
			const panel = state.areas.main;
			const active = panel.views.find(
				(view) => view.instance === panel.activeInstance,
			);
			if (!active || active.isPinned) return;
			const views = panel.views.filter(
				(view) => view.instance !== panel.activeInstance,
			);
			navigate(undefined);
			store.setSnapshot({
				...state,
				areas: {
					...state.areas,
					main: {
						...panel,
						views,
						activeInstance: views.at(-1)?.instance ?? null,
					},
				},
			});
		},
	};
}
