import type { Lix } from "@/lib/lix-types";
import { useLix, useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	type KeyDef,
	type ValueOf,
	type KnownKey,
	KEY_VALUE_DEFINITIONS,
} from "./schema";
import {
	createContext,
	useContext,
	createElement,
	useCallback,
	useRef,
	useState,
	useEffect,
} from "react";
import type React from "react";

type KVDefs = Record<string, KeyDef<any>>;
const KVDefsContext = createContext<KVDefs | null>(null);

/**
 * Provides key-value definitions to `useKeyValue` within a React subtree.
 *
 * Pass in a map of key definitions (branch scope, tracking, defaults) so the
 * hook can infer behavior for known keys.
 *
 * @example
 * const lix = await openLix({})
 * render(
 *   <LixProvider lix={lix}>
 *     <KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
 *       <App />
 *     </KeyValueProvider>
 *   </LixProvider>
 * )
 */
export function KeyValueProvider({
	defs,
	children,
}: {
	defs: KVDefs;
	children: React.ReactNode;
}) {
	// oxlint-disable-next-line no-children-prop
	return createElement(KVDefsContext.Provider, { value: defs, children });
}

/**
 * Options passed to `useKeyValue` to override defaults for a specific key.
 */
export type UseKeyValueOptions = {
	defaultBranchId?: "active" | "global" | string;
	untracked?: boolean;
};

type OptimisticSlot = {
	hasValue: boolean;
	value: unknown;
	listeners: Set<() => void>;
	notifyScheduled?: boolean;
};

const OPTIMISTIC_SLOTS = new WeakMap<object, Map<string, OptimisticSlot>>();

function notifyOptimisticListeners(slot: OptimisticSlot): void {
	if (slot.notifyScheduled) {
		return;
	}
	slot.notifyScheduled = true;
	queueMicrotask(() => {
		slot.notifyScheduled = false;
		const listeners = Array.from(slot.listeners);
		for (const listener of listeners) {
			listener();
		}
	});
}

function getOptimisticSlots(lix: Lix): Map<string, OptimisticSlot> {
	let slots = OPTIMISTIC_SLOTS.get(lix as object);
	if (!slots) {
		slots = new Map<string, OptimisticSlot>();
		OPTIMISTIC_SLOTS.set(lix as object, slots);
	}
	return slots;
}

function getOptimisticSlot(lix: Lix, key: string): OptimisticSlot {
	const slots = getOptimisticSlots(lix);
	let slot = slots.get(key);
	if (!slot) {
		slot = { hasValue: false, value: undefined, listeners: new Set() };
		slots.set(key, slot);
	}
	return slot;
}

function readOptimisticSnapshot(
	lix: Lix,
	key: string,
): {
	hasValue: boolean;
	value: unknown;
} {
	const slot = OPTIMISTIC_SLOTS.get(lix as object)?.get(key);
	if (!slot) {
		return { hasValue: false, value: undefined };
	}
	return { hasValue: slot.hasValue, value: slot.value };
}

function setOptimisticValue(lix: Lix, key: string, value: unknown): void {
	const slot = getOptimisticSlot(lix, key);
	if (slot.hasValue && valuesEqual(slot.value, value)) {
		return;
	}
	slot.hasValue = true;
	slot.value = value;
	notifyOptimisticListeners(slot);
}

function clearOptimisticValue(lix: Lix, key: string): void {
	const slots = OPTIMISTIC_SLOTS.get(lix as object);
	const slot = slots?.get(key);
	if (!slot) return;
	if (!slot.hasValue) return;
	slot.hasValue = false;
	slot.value = undefined;
	notifyOptimisticListeners(slot);
	if (slot.listeners.size === 0) {
		slots?.delete(key);
	}
}

function subscribeOptimistic(
	lix: Lix,
	key: string,
	listener: () => void,
): () => void {
	const slot = getOptimisticSlot(lix, key);
	slot.listeners.add(listener);
	return () => {
		slot.listeners.delete(listener);
		if (!slot.hasValue && slot.listeners.size === 0) {
			OPTIMISTIC_SLOTS.get(lix as object)?.delete(key);
		}
	};
}

function getDefaults(
	key: string,
	defs: Record<string, KeyDef<any>>,
): {
	defaultBranchId: "active" | "global" | string;
	untracked: boolean;
} {
	const def = defs[key];
	if (def) return def;
	// Lix defaults: active branch, tracked (untracked=false)
	return { defaultBranchId: "active", untracked: false };
}

// Overloads for strong typing on known keys
// Suspense behavior is handled by useQuery; no extra one-time loader needed.

/**
 * React hook for reading and writing a key-value setting.
 *
 * - Suspends on first load to ensure deterministic rendering.
 * - Re-renders on live DB updates via `useQuery` subscription.
 * - Honors per-key defaults from `KeyValueProvider` or built-in schema.
 *
 * @example
 * function ActiveFileBadge() {
 *   const [activeFileId] = useKeyValue('flashtype_active_file_id')
 *   return (
 *     <span>{activeFileId ?? 'No active file'}</span>
 *   )
 * }
 */
export function useKeyValue<K extends KnownKey>(
	key: K,
	opts?: UseKeyValueOptions,
): readonly [ValueOf<K> | null, (newValue: ValueOf<K>) => Promise<void>];
export function useKeyValue(
	key: string,
	opts?: UseKeyValueOptions,
): readonly [unknown | null, (newValue: unknown) => Promise<void>];
export function useKeyValue<K extends string>(
	key: K,
	opts?: UseKeyValueOptions,
): readonly [ValueOf<K> | null, (newValue: ValueOf<K>) => Promise<void>] {
	const lix = useLix();
	const providedDefs =
		useContext(KVDefsContext) ?? (KEY_VALUE_DEFINITIONS as KVDefs);
	const d = getDefaults(key as string, providedDefs);
	const defaultBranchId = opts?.defaultBranchId ?? d.defaultBranchId;
	const untracked = opts?.untracked ?? d.untracked;

	const [optimistic, setOptimisticState] = useState<{
		hasValue: boolean;
		value: ValueOf<K> | null;
	}>(() => {
		const snapshot = readOptimisticSnapshot(lix, key as string);
		return {
			hasValue: snapshot.hasValue,
			value: (snapshot.value ?? null) as ValueOf<K> | null,
		};
	});

	useEffect(() => {
		const snapshot = readOptimisticSnapshot(lix, key as string);
		const next = {
			hasValue: snapshot.hasValue,
			value: (snapshot.value ?? null) as ValueOf<K> | null,
		};
		setOptimisticState((prev) =>
			prev.hasValue === next.hasValue && valuesEqual(prev.value, next.value)
				? prev
				: next,
		);
	}, [lix, key]);

	useEffect(() => {
		const handle = () => {
			const snapshot = readOptimisticSnapshot(lix, key as string);
			const next = {
				hasValue: snapshot.hasValue,
				value: (snapshot.value ?? null) as ValueOf<K> | null,
			};
			setOptimisticState((prev) =>
				prev.hasValue === next.hasValue && valuesEqual(prev.value, next.value)
					? prev
					: next,
			);
		};
		return subscribeOptimistic(lix, key as string, handle);
	}, [lix, key]);

	const latestLixRef = useRef(lix);
	const latestKeyRef = useRef(key as string);
	const latestQueryValueRef = useRef<ValueOf<K> | null>(null);
	const latestOptimisticRef = useRef(optimistic);
	const lastOptimisticClearRef = useRef<string | null>(null);
	const resultRef = useRef<
		readonly [ValueOf<K> | null, (newValue: ValueOf<K>) => Promise<void>]
	>([null, async () => {}]);

	useEffect(() => {
		const latestOptimistic = latestOptimisticRef.current;
		if (!latestOptimistic.hasValue) return;
		if (valuesEqual(latestQueryValueRef.current, latestOptimistic.value)) {
			const clearKey = `${latestKeyRef.current}:${JSON.stringify(latestOptimistic.value)}`;
			if (lastOptimisticClearRef.current === clearKey) return;
			lastOptimisticClearRef.current = clearKey;
			clearOptimisticValue(latestLixRef.current, latestKeyRef.current);
		} else {
			lastOptimisticClearRef.current = null;
		}
	});

	const setValue = useCallback(
		async (newValue: ValueOf<K>) => {
			setOptimisticValue(lix, key as string, newValue as ValueOf<K> | null);
			await upsertValue(lix, key as string, newValue as unknown, {
				defaultBranchId: String(defaultBranchId),
				untracked,
			});
		},
		[lix, key, defaultBranchId, untracked],
	);

	// Subscribe to live updates and suspend on first load via useQuery. Keep this
	// after the hook setup above so suspense retries preserve hook order.
	const rows = useQuery<{ value: unknown }>((lix) =>
		selectValue(lix, key as string, {
			defaultBranchId: String(defaultBranchId),
			untracked,
		}),
	);
	const defVal = (providedDefs as any)[key]?.defaultValue ?? null;
	const value = (
		rows && rows[0]?.value !== undefined ? rows[0]?.value : defVal
	) as ValueOf<K> | null;
	const resolvedValue = optimistic.hasValue ? optimistic.value : value;

	latestKeyRef.current = key as string;
	latestLixRef.current = lix;
	latestQueryValueRef.current = value;
	latestOptimisticRef.current = optimistic;

	if (
		resultRef.current[1] !== setValue ||
		!valuesEqual(resultRef.current[0], resolvedValue)
	) {
		resultRef.current = [resolvedValue, setValue] as const;
	}

	return resultRef.current;
}

function selectValue(
	lix: Lix,
	key: string,
	opts: { defaultBranchId: string; untracked: boolean },
) {
	if (opts.defaultBranchId !== "active") {
		return qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("lixcol_branch_id", "=", opts.defaultBranchId)
			.where("key", "=", key)
			.select(["value"]);
	}

	return qb(lix)
		.selectFrom("lix_key_value")
		.where("key", "=", key)
		.select(["value"]);
}

async function upsertValue<T>(
	lix: Lix,
	key: string,
	value: T,
	opts: { defaultBranchId: string; untracked: boolean },
) {
	if (opts.defaultBranchId === "active") {
		await qb(lix)
			.insertInto("lix_key_value")
			.values({
				key,
				value,
				lixcol_untracked: opts.untracked,
			})
			.onConflict((oc) => oc.column("key").doUpdateSet({ value }))
			.execute();
		return;
	}

	const branchId = opts.defaultBranchId;
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key,
			value,
			lixcol_branch_id: branchId,
			lixcol_global: branchId === "global",
			lixcol_untracked: opts.untracked,
		})
		.onConflict((oc) =>
			oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value }),
		)
		.execute();
}

function valuesEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === undefined || b === undefined) return a === b;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}
