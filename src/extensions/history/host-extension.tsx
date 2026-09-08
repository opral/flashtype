import { createRoot } from "react-dom/client";
import { History } from "lucide-react";
import {
	Atelier,
	ATELIER_BUILTIN_EXTENSION_IDS,
	type AtelierExtensionRegistration,
	type AtelierExtensionRuntime,
} from "@opral/atelier";
import { TemporaryHistoryNotice } from "@/shell/temporary-history-notice";

/** Flashtype owns persistence messaging; Atelier owns the timeline and reviews. */
export function createHistoryExtension(
	temporary: boolean,
): AtelierExtensionRegistration {
	return {
		manifest: {
			apiVersion: 1,
			id: ATELIER_BUILTIN_EXTENSION_IDS.history,
			name: "History",
			placement: ["left", "right", "central"],
		},
		entry: {
			icon: History,
			mount: ({ element, atelier }) => {
				const root = createRoot(element);
				const render = (runtime: AtelierExtensionRuntime) => {
					if (!runtime.diff)
						throw new Error("History requires the shell's diff runtime");
					root.render(
						<div className="flex min-h-0 flex-1 flex-col">
							{temporary ? (
								<div className="shrink-0 pt-2">
									<TemporaryHistoryNotice />
								</div>
							) : null}
							<Atelier.History atelier={{ ...runtime, diff: runtime.diff }} />
						</div>,
					);
				};
				render(atelier);
				return {
					update: ({ atelier }) => render(atelier),
					dispose: () => root.unmount(),
				};
			},
		},
	};
}
