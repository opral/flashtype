import type {
	AtelierBuiltinExtensionId,
	AtelierExtensionRegistration,
} from "@opral/atelier";
import type { WorkspaceContext } from "@/extension-runtime/types";
import { createFilesExtensionRegistration } from "./files/host-extension";
import { FLASHTYPE_ATELIER_EXTENSIONS as TERMINAL_EXTENSIONS } from "./terminal/host-extensions";

export const FLASHTYPE_FILES_EXTENSION_ID =
	"atelier_files" satisfies AtelierBuiltinExtensionId;

export function createFlashTypeAtelierExtensions(
	workspace: WorkspaceContext,
): readonly AtelierExtensionRegistration[] {
	return [createFilesExtensionRegistration(workspace), ...TERMINAL_EXTENSIONS];
}
