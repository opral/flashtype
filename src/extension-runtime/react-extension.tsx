import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LucideIcon } from "lucide-react";
import type {
	ExtensionContext,
	ExtensionDefinition,
	ExtensionInstance,
	ExtensionKind,
} from "./types";
import { normalizeFileExtensions } from "./file-handlers";

type ReactRenderer = (args: {
	context: ExtensionContext;
	instance: ExtensionInstance;
}) => ReactNode;

type ReactActivator = (args: {
	context: ExtensionContext;
	instance: ExtensionInstance;
}) => void | (() => void);

export function createReactExtensionDefinition(args: {
	kind: ExtensionKind;
	label: string;
	description: string;
	icon: LucideIcon;
	fileExtensions?: readonly string[];
	multiInstance?: boolean;
	component: ReactRenderer;
	activate?: ReactActivator;
}): ExtensionDefinition {
	const ROOT_SLOT = Symbol.for("flashtype.reactRoot");

	return {
		kind: args.kind,
		label: args.label,
		description: args.description,
		icon: args.icon,
		fileExtensions: normalizeFileExtensions(args.fileExtensions),
		multiInstance: args.multiInstance,
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
