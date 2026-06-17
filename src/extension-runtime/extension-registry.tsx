import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { ExtensionDefinition, ExtensionKind } from "./types";
import {
	BUILTIN_VISIBLE_EXTENSION_DEFINITIONS,
	BUILTIN_EXTENSION_DEFINITIONS,
} from "./builtin-extension-registry";
import { normalizeInstalledExtensionDefinitions } from "./installed-extension-registry";

type ExtensionRegistryValue = {
	readonly visibleExtensions: ExtensionDefinition[];
	readonly extensionMap: Map<ExtensionKind, ExtensionDefinition>;
	readonly installedExtensions: ExtensionDefinition[];
	replaceInstalledExtensions: (
		definitions: readonly ExtensionDefinition[],
	) => void;
	clearInstalledExtensions: () => void;
};

const buildExtensionRegistry = (
	installedDefinitions: readonly ExtensionDefinition[],
): Pick<ExtensionRegistryValue, "visibleExtensions" | "extensionMap"> => {
	const builtinKinds = new Set(
		BUILTIN_EXTENSION_DEFINITIONS.map((def) => def.kind),
	);
	const installedVisible = normalizeInstalledExtensionDefinitions(
		installedDefinitions,
	).filter((def) => !builtinKinds.has(def.kind));

	const visibleExtensions = [
		...BUILTIN_VISIBLE_EXTENSION_DEFINITIONS,
		...installedVisible,
	];
	const extensionMap = new Map<ExtensionKind, ExtensionDefinition>(
		[...BUILTIN_EXTENSION_DEFINITIONS, ...installedVisible].map((def) => [
			def.kind,
			def,
		]),
	);

	return { visibleExtensions, extensionMap };
};

const BASE_REGISTRY = buildExtensionRegistry([]);

export const EXTENSION_DEFINITIONS: ExtensionDefinition[] =
	BASE_REGISTRY.visibleExtensions;
export const EXTENSION_MAP: Map<ExtensionKind, ExtensionDefinition> =
	BASE_REGISTRY.extensionMap;

const NOOP = () => {};

const ExtensionRegistryContext = createContext<ExtensionRegistryValue>({
	visibleExtensions: EXTENSION_DEFINITIONS,
	extensionMap: EXTENSION_MAP,
	installedExtensions: [],
	replaceInstalledExtensions: NOOP,
	clearInstalledExtensions: NOOP,
});

export function ExtensionRegistryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [installedExtensions, setInstalledExtensions] = useState<
		ExtensionDefinition[]
	>([]);

	const replaceInstalledExtensions = useCallback(
		(definitions: readonly ExtensionDefinition[]) => {
			setInstalledExtensions(
				normalizeInstalledExtensionDefinitions(definitions),
			);
		},
		[],
	);

	const clearInstalledExtensions = useCallback(() => {
		setInstalledExtensions([]);
	}, []);

	const value = useMemo<ExtensionRegistryValue>(() => {
		const merged = buildExtensionRegistry(installedExtensions);
		return {
			visibleExtensions: merged.visibleExtensions,
			extensionMap: merged.extensionMap,
			installedExtensions,
			replaceInstalledExtensions,
			clearInstalledExtensions,
		};
	}, [
		installedExtensions,
		replaceInstalledExtensions,
		clearInstalledExtensions,
	]);

	return (
		<ExtensionRegistryContext.Provider value={value}>
			{children}
		</ExtensionRegistryContext.Provider>
	);
}

export function useExtensionRegistry(): ExtensionRegistryValue {
	return useContext(ExtensionRegistryContext);
}

let extensionCounter = 0;

export function createExtensionInstanceId(kind: ExtensionKind): string {
	extensionCounter += 1;
	return `${kind}-${extensionCounter}`;
}
