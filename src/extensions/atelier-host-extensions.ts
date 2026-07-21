import type { AtelierExtensionRegistration } from "@opral/atelier";
import { FLASHTYPE_ATELIER_EXTENSIONS as TERMINAL_EXTENSIONS } from "./terminal/host-extensions";

/**
 * FlashType-owned atelier extensions. The Files view is atelier's bundled
 * extension (transient workspaces feed it watched disk entries through
 * `createAtelier({ filesView })`).
 */
export function createFlashTypeAtelierExtensions(): readonly AtelierExtensionRegistration[] {
	return [...TERMINAL_EXTENSIONS];
}
