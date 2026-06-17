import type { ExtensionDefinition } from "./types";

export function normalizeInstalledExtensionDefinitions(
	definitions: readonly ExtensionDefinition[],
): ExtensionDefinition[] {
	const dedupedByKind = new Map<string, ExtensionDefinition>();
	for (const definition of definitions) {
		if (dedupedByKind.has(definition.kind)) continue;
		dedupedByKind.set(definition.kind, definition);
	}
	return [...dedupedByKind.values()];
}
