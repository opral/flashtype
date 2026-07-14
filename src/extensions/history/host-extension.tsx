import { createRoot } from "react-dom/client";
import { History } from "lucide-react";
import type {
	AtelierBuiltinExtensionId,
	AtelierExtensionRegistration,
	AtelierExtensionRuntime,
	ExtensionManifest,
} from "@opral/atelier";
import { LixProvider } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { HistoryView } from "./index";
import manifestJson from "./history.manifest.json";

const manifest = {
	...manifestJson,
	id: "atelier_history" satisfies AtelierBuiltinExtensionId,
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
			<HistoryView
				currentRevision={atelier.revisions.current}
				showCheckpointDiff={atelier.revisions.show}
				clearCheckpointDiff={atelier.revisions.clear}
			/>
		</LixProvider>,
	);
}
