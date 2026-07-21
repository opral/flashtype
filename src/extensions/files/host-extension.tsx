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
				const openRequest = { current: 0 };
				renderFilesView(root, workspace, atelier, view, openRequest);
				return {
					update: ({ atelier: nextAtelier, view: nextView }) => {
						renderFilesView(
							root,
							workspace,
							nextAtelier,
							nextView,
							openRequest,
						);
					},
					dispose: () => {
						openRequest.current += 1;
						root.unmount();
					},
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
	openRequest: { current: number },
) {
	const lix = atelier.lix as unknown as Lix;
	const context: ExtensionContext = {
		lix,
		workspace,
		openFile: ({ fileId, filePath, state, focus, pending, documentOrigin }) => {
			const requestId = ++openRequest.current;
			return openWorkspaceFile(
				atelier,
				{
					fileId,
					filePath,
					state,
					focus,
					pending,
					documentOrigin,
				},
				() => requestId === openRequest.current,
			);
		},
		closeFileViews: ({ filePath }) => {
			if (filePath) {
				void atelier.documents.close(filePath);
				return;
			}
			void atelier.documents.closeActive();
		},
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
	isCurrentRequest: () => boolean,
): Promise<void> {
	const lix = atelier.lix as unknown as Lix;
	if (args.fileId.startsWith("watched:")) {
		let importedFile = await qb(lix)
			.selectFrom("lix_file")
			.select("id")
			.where("path", "=", args.filePath)
			.executeTakeFirst();
		if (!isCurrentRequest()) return;
		if (!importedFile?.id) {
			await lix.importFilesystemPaths([args.filePath.replace(/^\/+/, "")]);
			if (!isCurrentRequest()) return;
			importedFile = await qb(lix)
				.selectFrom("lix_file")
				.select("id")
				.where("path", "=", args.filePath)
				.executeTakeFirst();
			if (!isCurrentRequest()) return;
		}
		if (!importedFile?.id) {
			throw new Error(`Imported file id not found for '${args.filePath}'.`);
		}
	}
	if (!isCurrentRequest()) return;
	await atelier.documents.open(args.filePath, {
		...(args.state ? { state: args.state } : {}),
		...(args.focus !== undefined ? { focus: args.focus } : {}),
		...(args.documentOrigin ? { documentOrigin: args.documentOrigin } : {}),
	});
}
