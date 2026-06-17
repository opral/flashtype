import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
import type {
	ExtensionContext,
	ExtensionDefinition,
	ExtensionInstance,
} from "./types";

export type ExtensionHostRecord = {
	readonly instanceId: string;
	readonly container: HTMLDivElement;
	view: ExtensionDefinition;
	instance: ExtensionInstance;
	cleanup: (() => void) | undefined;
	lastContext: ExtensionContext;
};

type EnsureArgs = {
	instance: ExtensionInstance;
	view: ExtensionDefinition;
	context: ExtensionContext;
};

type ExtensionHostRegistry = {
	ensureHost: (args: EnsureArgs) => ExtensionHostRecord;
	pruneHosts: (activeInstances: Set<string>) => void;
};

const ExtensionHostRegistryContext =
	createContext<ExtensionHostRegistry | null>(null);

export function ExtensionHostRegistryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const hostsRef = useRef<Map<string, ExtensionHostRecord>>(new Map());

	const ensureHost = useCallback(
		({ instance, view, context }: EnsureArgs): ExtensionHostRecord => {
			let record = hostsRef.current.get(instance.instance);
			if (!record) {
				const container = document.createElement("div");
				container.className =
					"flex min-h-0 flex-1 flex-col overflow-hidden w-full h-full";
				const maybeCleanup = view.render({
					context,
					instance,
					target: container,
				});
				const cleanup =
					typeof maybeCleanup === "function" ? maybeCleanup : undefined;
				record = {
					instanceId: instance.instance,
					container,
					view,
					instance,
					cleanup,
					lastContext: context,
				};
				hostsRef.current.set(instance.instance, record);
				return record;
			}

			record.cleanup?.();
			const maybeCleanup = view.render({
				context,
				instance,
				target: record.container,
			});
			record.cleanup =
				typeof maybeCleanup === "function" ? maybeCleanup : undefined;
			record.instance = instance;
			record.view = view;
			record.lastContext = context;
			return record;
		},
		[],
	);

	const pruneHosts = useCallback((activeInstances: Set<string>) => {
		for (const [key, record] of hostsRef.current) {
			if (activeInstances.has(key)) continue;
			record.cleanup?.();
			record.container.remove();
			hostsRef.current.delete(key);
		}
	}, []);

	const value = useMemo<ExtensionHostRegistry>(
		() => ({
			ensureHost,
			pruneHosts,
		}),
		[ensureHost, pruneHosts],
	);

	return (
		<ExtensionHostRegistryContext.Provider value={value}>
			{children}
		</ExtensionHostRegistryContext.Provider>
	);
}

export function useExtensionHostRegistry(): ExtensionHostRegistry {
	const ctx = useContext(ExtensionHostRegistryContext);
	if (!ctx) {
		throw new Error(
			"useExtensionHostRegistry must be used within the provider.",
		);
	}
	return ctx;
}
