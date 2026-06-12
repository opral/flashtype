import type { WidgetDefinition } from "./types";
import { widget as filesWidgetDefinition } from "../widgets/files";
import { widget as markdownWidgetDefinition } from "../widgets/markdown";
import { widget as csvWidgetDefinition } from "../widgets/csv";
import { widget as diffWidgetDefinition } from "../widgets/diff";
import { widget as terminalWidgetDefinition } from "../widgets/terminal";

export const BUILTIN_VISIBLE_WIDGET_DEFINITIONS: WidgetDefinition[] = [
	filesWidgetDefinition,
	terminalWidgetDefinition,
];

export const BUILTIN_HIDDEN_WIDGET_DEFINITIONS: WidgetDefinition[] = [
	markdownWidgetDefinition,
	csvWidgetDefinition,
	diffWidgetDefinition,
];

export const BUILTIN_WIDGET_DEFINITIONS: WidgetDefinition[] = [
	...BUILTIN_VISIBLE_WIDGET_DEFINITIONS,
	...BUILTIN_HIDDEN_WIDGET_DEFINITIONS,
];
