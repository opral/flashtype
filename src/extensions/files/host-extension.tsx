import { createRoot, type Root } from "react-dom/client";
import { Files } from "lucide-react";
import type {
	AtelierBuiltinExtensionId,
	AtelierExtensionRegistration,
	AtelierExtensionRuntime,
	AtelierExtensionState,
	AtelierExtensionView,
	ExtensionManifest,
} from "@opral/atelier";
import { LixProvider } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import type {
	ExtensionContext,
	WorkspaceContext,
} from "@/extension-runtime/types";
import { qb } from "@/lib/lix-kysely";
import { FilesView } from "./index";
import manifestJson from "./files.manifest.json";

const manifest = {
	...manifestJson,
	id: "atelier_files" satisfies AtelierBuiltinExtensionId,
} as ExtensionManifest;

export function createFilesExtensionRegistration(
	workspace: WorkspaceContext,
): AtelierExtensionRegistration {
	return {
		manifest,
		entry: {
			icon: Files,
			mount: ({ element, atelier, view }) => {
				const root = createRoot(element);
				renderFilesView(root, workspace, atelier, view);
				return {
					update: ({ atelier: nextAtelier, view: nextView }) => {
						renderFilesView(root, workspace, nextAtelier, nextView);
					},
					dispose: () => root.unmount(),
				};
			},
		},
	};
}

function renderFilesView(
	root: Root,
	workspace: WorkspaceContext,
	atelier: AtelierExtensionRuntime,
	view: AtelierExtensionView,
) {
	const lix = atelier.lix as unknown as Lix;
	const context: ExtensionContext = {
		lix,
		workspace,
		openFile: ({ fileId, filePath, state, focus, pending, documentOrigin }) =>
			openWorkspaceFile(atelier, {
				fileId,
				filePath,
				state,
				focus,
				pending,
				documentOrigin,
			}),
		closeFileViews: () => {
			void atelier.documents.closeActive();
		},
		checkpointBranchId: atelier.revisions.current?.branchId ?? null,
		isPanelFocused: view.isFocused,
		panelSide: view.panel,
		viewInstance: view.instanceId,
		isActiveView: view.isActive,
		registerNewFileDraftHandler: ({ handler }) =>
			view.registerNewFileDraftHandler(handler),
		setTabBadgeCount: () => {},
	};

	root.render(
		<LixProvider lix={context.lix}>
			<FilesView context={context} />
		</LixProvider>,
	);
}

async function openWorkspaceFile(
	atelier: AtelierExtensionRuntime,
	args: {
		readonly fileId: string;
		readonly filePath: string;
		readonly state?: AtelierExtensionState;
		readonly focus?: boolean;
		readonly pending?: boolean;
		readonly documentOrigin?: "existing" | "new";
	},
): Promise<void> {
	const lix = atelier.lix as unknown as Lix;
	if (args.fileId.startsWith("watched:")) {
		let importedFile = await qb(lix)
			.selectFrom("lix_file")
			.select("id")
			.where("path", "=", args.filePath)
			.executeTakeFirst();
		if (!importedFile?.id) {
			await lix.importFilesystemPaths([args.filePath.replace(/^\/+/, "")]);
			importedFile = await qb(lix)
				.selectFrom("lix_file")
				.select("id")
				.where("path", "=", args.filePath)
				.executeTakeFirst();
		}
		if (!importedFile?.id) {
			throw new Error(`Imported file id not found for '${args.filePath}'.`);
		}
	}
	await atelier.documents.open(args.filePath, {
		...(args.state ? { state: args.state } : {}),
		...(args.focus !== undefined ? { focus: args.focus } : {}),
		...(args.documentOrigin ? { documentOrigin: args.documentOrigin } : {}),
	});
}
