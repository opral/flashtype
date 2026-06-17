import type { ExtensionDefinition } from "./types";
import { extension as filesExtensionDefinition } from "../extensions/files";
import { extension as markdownExtensionDefinition } from "../extensions/markdown";
import { extension as csvExtensionDefinition } from "../extensions/csv";
import { extension as diffExtensionDefinition } from "../extensions/diff";
import { extension as terminalExtensionDefinition } from "../extensions/terminal";

export const BUILTIN_VISIBLE_EXTENSION_DEFINITIONS: ExtensionDefinition[] = [
	filesExtensionDefinition,
	terminalExtensionDefinition,
];

export const BUILTIN_HIDDEN_EXTENSION_DEFINITIONS: ExtensionDefinition[] = [
	markdownExtensionDefinition,
	csvExtensionDefinition,
	diffExtensionDefinition,
];

export const BUILTIN_EXTENSION_DEFINITIONS: ExtensionDefinition[] = [
	...BUILTIN_VISIBLE_EXTENSION_DEFINITIONS,
	...BUILTIN_HIDDEN_EXTENSION_DEFINITIONS,
];
