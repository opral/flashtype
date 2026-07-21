import { createRoot } from "react-dom/client";
import { History } from "lucide-react";
import type {
	AtelierExtensionRegistration,
	AtelierExtensionRuntime,
	ExtensionManifest,
} from "@opral/atelier";
import { LixProvider } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { HistoryView } from "./index";
import manifestJson from "./history.manifest.json";

// Atelier removed its bundled history extension (opral/atelier#59); the id is
// now FlashType-owned but kept stable for persisted layouts.
const manifest = {
	...manifestJson,
	id: "atelier_history",
} as ExtensionManifest;

/**
 * FlashType owns this history view because checkpoint creation synchronizes the
 * Electron filesystem and checkpoint naming calls the Electron agent bridge.
 */
export function createHistoryExtensionRegistration(): AtelierExtensionRegistration {
	return {
		manifest,
		entry: {
			icon: History,
			mount: ({ element, atelier }) => {
				const root = createRoot(element);
				renderHistoryView(root, atelier);
				return {
					update: ({ atelier: nextAtelier }) =>
						renderHistoryView(root, nextAtelier),
					dispose: () => root.unmount(),
				};
			},
		},
	};
}

function renderHistoryView(
	root: ReturnType<typeof createRoot>,
	atelier: AtelierExtensionRuntime,
) {
	root.render(
		<LixProvider lix={atelier.lix as unknown as Lix}>
			{/* Atelier's revisions runtime (checkpoint diff viewer) was removed
			    upstream; the view degrades gracefully without those props. */}
			<HistoryView />
		</LixProvider>,
	);
}
