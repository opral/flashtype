import { createHistoryExtension } from "./history/host-extension";
import type { AtelierExtensionRegistration } from "@opral/atelier";
import { FLASHTYPE_ATELIER_EXTENSIONS as TERMINAL_EXTENSIONS } from "./terminal/host-extensions";

/**
 * FlashType-owned atelier extensions. The Files view is atelier's bundled
 * extension (transient workspaces feed it watched disk entries through
 * `createAtelier({ filesView })`).
 */
export function createFlashTypeAtelierExtensions(
	options: { temporaryHistory?: boolean } = {},
): readonly AtelierExtensionRegistration[] {
	return [
		...TERMINAL_EXTENSIONS,
		createHistoryExtension(options.temporaryHistory === true),
	];
}
