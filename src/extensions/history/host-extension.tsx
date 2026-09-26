import { History } from "lucide-react";
import {
	Atelier,
	ATELIER_BUILTIN_EXTENSION_IDS,
	type AtelierExtensionRegistration,
} from "@opral/atelier";
import { TemporaryHistoryNotice } from "@/shell/temporary-history-notice";

/** Flashtype owns persistence messaging; Atelier owns the timeline and reviews. */
export function createHistoryExtension(
	temporary: boolean,
): AtelierExtensionRegistration {
	return {
		id: ATELIER_BUILTIN_EXTENSION_IDS.history,
		name: "History",
		placement: ["left", "right", "main"],
		icon: History,
		HeaderAccessory: ({ atelier, view }) => {
			if (!atelier.diff) return null;
			return (
				<Atelier.HistoryScopeSwitch
					atelier={{ ...atelier, diff: atelier.diff }}
					preferences={view.preferences}
				/>
			);
		},
		Component: ({ atelier, view }) => {
			if (!atelier.diff)
				throw new Error("History requires the shell's diff runtime");
			return (
				<div className="flex min-h-0 flex-1 flex-col">
					{temporary ? (
						<div className="shrink-0 pt-2">
							<TemporaryHistoryNotice />
						</div>
					) : null}
					<Atelier.History
						atelier={{ ...atelier, diff: atelier.diff }}
						preferences={view.preferences}
					/>
				</div>
			);
		},
	};
}
