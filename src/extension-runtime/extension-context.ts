import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	PanelSide,
	PanelState,
	ExtensionContext,
	ExtensionInstance,
} from "./types";

type UsePanelViewContextArgs = {
	panel: PanelState;
	panelSide: PanelSide;
	isFocused: boolean;
	parentContext: ExtensionContext;
};

export function useExtensionContext({
	panel,
	panelSide,
	isFocused,
	parentContext,
}: UsePanelViewContextArgs): {
	badgeCounts: Record<string, number>;
	makeContext: (instance: ExtensionInstance) => ExtensionContext;
} {
	const baseContext = useMemo<ExtensionContext>(() => {
		if (parentContext.isPanelFocused === isFocused) return parentContext;
		return { ...parentContext, isPanelFocused: isFocused };
	}, [parentContext, isFocused]);

	const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
	const setterRef = useRef<
		Record<string, (count: number | null | undefined) => void>
	>({});
	const contextRef = useRef<
		Record<
			string,
			{
				readonly baseContext: ExtensionContext;
				readonly context: ExtensionContext;
			}
		>
	>({});

	useEffect(() => {
		setBadgeCounts((prev) => {
			const next = { ...prev };
			let mutated = false;
			for (const key of Object.keys(prev)) {
				if (!panel.views.some((view) => view.instance === key)) {
					delete next[key];
					mutated = true;
				}
			}
			return mutated ? next : prev;
		});

		for (const key of Object.keys(setterRef.current)) {
			if (!panel.views.some((view) => view.instance === key)) {
				delete setterRef.current[key];
				delete contextRef.current[key];
			}
		}
	}, [panel.views]);

	const getBadgeSetter = useCallback((instanceId: string) => {
		const cached = setterRef.current[instanceId];
		if (cached) return cached;
		const setter = (count: number | null | undefined) => {
			setBadgeCounts((prev) => {
				if (
					count === null ||
					count === undefined ||
					!Number.isFinite(count) ||
					Number(count) <= 0
				) {
					if (!(instanceId in prev)) return prev;
					const { [instanceId]: _, ...rest } = prev;
					return rest;
				}
				const normalized = Number(count);
				if (prev[instanceId] === normalized) return prev;
				return { ...prev, [instanceId]: normalized };
			});
		};
		setterRef.current[instanceId] = setter;
		return setter;
	}, []);

	useEffect(() => {
		contextRef.current = {};
	}, [baseContext]);

	const makeContext = useCallback(
		(instance: ExtensionInstance): ExtensionContext => {
			const setCount = getBadgeSetter(instance.instance);
			const cached = contextRef.current[instance.instance];
			const focusValue = baseContext.isPanelFocused ?? isFocused;
			const isActiveView = panel.activeInstance === instance.instance;
			if (
				cached &&
				cached.baseContext === baseContext &&
				cached.context.setTabBadgeCount === setCount &&
				cached.context.panelSide === panelSide &&
				cached.context.viewInstance === instance.instance &&
				cached.context.isPanelFocused === focusValue &&
				cached.context.isActiveView === isActiveView
			) {
				return cached.context;
			}

			const next: ExtensionContext = {
				...baseContext,
				setTabBadgeCount: setCount,
				panelSide,
				viewInstance: instance.instance,
				isActiveView,
				isPanelFocused: focusValue,
			};
			contextRef.current[instance.instance] = { baseContext, context: next };
			return next;
		},
		[baseContext, getBadgeSetter, isFocused, panel.activeInstance, panelSide],
	);

	return { badgeCounts, makeContext };
}
