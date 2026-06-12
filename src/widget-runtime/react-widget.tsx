import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LucideIcon } from "lucide-react";
import type {
	WidgetContext,
	WidgetDefinition,
	WidgetInstance,
	WidgetKind,
} from "./types";
import { normalizeFileExtensions } from "./file-handlers";

type ReactRenderer = (args: {
	context: WidgetContext;
	instance: WidgetInstance;
}) => ReactNode;

type ReactActivator = (args: {
	context: WidgetContext;
	instance: WidgetInstance;
}) => void | (() => void);

export function createReactWidgetDefinition(args: {
	kind: WidgetKind;
	label: string;
	description: string;
	icon: LucideIcon;
	fileExtensions?: readonly string[];
	component: ReactRenderer;
	activate?: ReactActivator;
}): WidgetDefinition {
	const ROOT_SLOT = Symbol.for("flashtype.reactRoot");

	return {
		kind: args.kind,
		label: args.label,
		description: args.description,
		icon: args.icon,
		fileExtensions: normalizeFileExtensions(args.fileExtensions),
		activate: args.activate,
		render: ({ context, instance, target }) => {
			let root = (target as unknown as Record<symbol, Root | undefined>)[
				ROOT_SLOT
			];
			if (!root) {
				root = createRoot(target);
				(target as unknown as Record<symbol, Root | undefined>)[ROOT_SLOT] =
					root;
			}
			root.render(args.component({ context, instance }));
			return () => {
				root?.render(null);
			};
		},
	};
}
