import {
	createContext,
	use,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ReactNode } from "react";
import type { Lix } from "@/lib/lix-types";

export const LixContext = createContext<Lix | null>(null);

export function LixProvider(props: { lix: Lix; children: ReactNode }) {
	return (
		<LixContext.Provider value={props.lix}>
			{props.children}
		</LixContext.Provider>
	);
}

export function useLix() {
	const lix = useContext(LixContext);
	if (!lix) {
		throw new Error("useLix must be used inside <LixProvider>.");
	}
	return lix;
}

type QueryCacheEntry<TRow> = {
	promise: Promise<TRow[]>;
	rows?: TRow[];
	error?: unknown;
};

type QueryObserverSubscriber<TRow> = {
	onRows(rows: TRow[]): void;
	onError(error: unknown): void;
};

type QueryObserverEntry<TRow> = {
	events: ReturnType<Lix["observe"]>;
	subscribers: Set<QueryObserverSubscriber<TRow>>;
	closed: boolean;
};

const queryCache = new Map<string, QueryCacheEntry<any>>();
const observeQueryCache = new Map<
	string,
	{ sql: string; params: ReadonlyArray<unknown> }
>();
const observeSubscriptionCache = new Map<string, QueryObserverEntry<any>>();
const lixInstanceIds = new WeakMap<object, number>();
let nextLixInstanceId = 1;

interface UseQueryOptions {
	subscribe?: boolean;
}

interface QueryLike<TRow> {
	compile(): {
		sql: string;
		parameters: ReadonlyArray<unknown>;
	};
	execute(): Promise<TRow[]>;
}

type QueryFactory<TRow> = (lix: Lix) => QueryLike<TRow>;

export function useQuery<TRow>(
	query: QueryFactory<TRow>,
	options: UseQueryOptions = {},
): TRow[] {
	const lix = useLix();
	const { subscribe = true } = options;
	const builder = query(lix);
	const compiled = builder.compile();
	const cacheKey =
		`${getLixInstanceId(lix)}:${subscribe ? "sub" : "once"}:` +
		`${compiled.sql}:${JSON.stringify(compiled.parameters)}`;
	const observeQuery = getObserveQuery(cacheKey, compiled);

	const entry = getQueryCacheEntry(cacheKey, builder);
	const cachedRows = entry.rows as TRow[] | undefined;
	const [, setRows] = useState<TRow[]>(() => cachedRows ?? []);
	const rowsRef = useRef<TRow[] | undefined>(cachedRows);

	useEffect(() => {
		if (cachedRows === undefined) return;
		rowsRef.current = cachedRows;
		setRows(cachedRows);
	}, [cacheKey, cachedRows]);

	useEffect(() => {
		if (!subscribe) return;
		return subscribeToQueryObserver<TRow>(cacheKey, lix, observeQuery, {
			onRows(nextRows) {
				if (rowsEqual(rowsRef.current, nextRows)) {
					return;
				}
				rowsRef.current = nextRows;
				setRows(nextRows);
			},
			onError(error) {
				setRows(() => {
					throw error instanceof Error ? error : new Error(String(error));
				});
			},
		});
	}, [cacheKey, subscribe, lix, observeQuery]);

	if (entry.error !== undefined) {
		throw entry.error instanceof Error
			? entry.error
			: new Error(String(entry.error));
	}
	const initialRows = cachedRows ?? use(entry.promise);

	return subscribe
		? (cachedRows ?? rowsRef.current ?? initialRows)
		: initialRows;
}

function subscribeToQueryObserver<TRow>(
	cacheKey: string,
	lix: Lix,
	observeQuery: { sql: string; params: ReadonlyArray<unknown> },
	subscriber: QueryObserverSubscriber<TRow>,
): () => void {
	const entry = getQueryObserverEntry<TRow>(cacheKey, lix, observeQuery);
	entry.subscribers.add(subscriber);
	return () => {
		entry.subscribers.delete(subscriber);
		if (entry.subscribers.size > 0) {
			return;
		}
		closeQueryObserverEntry(cacheKey, entry);
	};
}

function getQueryObserverEntry<TRow>(
	cacheKey: string,
	lix: Lix,
	observeQuery: { sql: string; params: ReadonlyArray<unknown> },
): QueryObserverEntry<TRow> {
	const cached = observeSubscriptionCache.get(cacheKey) as
		| QueryObserverEntry<TRow>
		| undefined;
	if (cached && !cached.closed) {
		return cached;
	}

	const entry: QueryObserverEntry<TRow> = {
		events: lix.observe(observeQuery.sql, observeQuery.params),
		subscribers: new Set(),
		closed: false,
	};
	observeSubscriptionCache.set(cacheKey, entry);
	void runQueryObserver(cacheKey, entry);
	return entry;
}

async function runQueryObserver<TRow>(
	cacheKey: string,
	entry: QueryObserverEntry<TRow>,
): Promise<void> {
	try {
		while (!entry.closed) {
			const event = await entry.events.next();
			if (entry.closed || event === undefined) break;
			const nextRows = queryResultToRows<TRow>(event.result);
			cacheQueryRows(cacheKey, nextRows);
			for (const subscriber of Array.from(entry.subscribers)) {
				subscriber.onRows(nextRows);
			}
		}
	} catch (error) {
		if (entry.closed) return;
		queryCache.delete(cacheKey);
		for (const subscriber of Array.from(entry.subscribers)) {
			subscriber.onError(error);
		}
	} finally {
		if (!entry.closed) {
			closeQueryObserverEntry(cacheKey, entry);
		}
	}
}

function closeQueryObserverEntry<TRow>(
	cacheKey: string,
	entry: QueryObserverEntry<TRow>,
): void {
	if (entry.closed) {
		return;
	}
	entry.closed = true;
	observeSubscriptionCache.delete(cacheKey);
	entry.events.close();
}

export const useQueryTakeFirst = <TResult,>(
	query: QueryFactory<TResult>,
	options: UseQueryOptions = {},
): TResult | undefined => {
	return useQuery<TResult>(query, options)[0];
};

export const useQueryTakeFirstOrThrow = <TResult,>(
	query: QueryFactory<TResult>,
	options: UseQueryOptions = {},
): TResult => {
	const data = useQueryTakeFirst(query, options);
	if (data === undefined) {
		throw new Error("No result found");
	}
	return data;
};

function queryResultToRows<TRow>(result: {
	rows?: ReadonlyArray<{
		toObject(): Record<string, unknown>;
	}>;
}): TRow[] {
	const rows = Array.isArray(result?.rows) ? result.rows : [];
	return rows.map((row) => row.toObject() as TRow);
}

function rowsEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	try {
		return JSON.stringify(a) === JSON.stringify(b);
	} catch {
		return false;
	}
}

function getQueryCacheEntry<TRow>(
	cacheKey: string,
	builder: QueryLike<TRow>,
): QueryCacheEntry<TRow> {
	const cached = queryCache.get(cacheKey) as QueryCacheEntry<TRow> | undefined;
	if (cached) return cached;

	const entry: QueryCacheEntry<TRow> = {
		promise: builder.execute().then(
			(rows) => {
				entry.rows = rows;
				return rows;
			},
			(error: unknown) => {
				entry.error = error;
				queryCache.delete(cacheKey);
				throw error;
			},
		),
	};
	queryCache.set(cacheKey, entry);
	return entry;
}

function cacheQueryRows<TRow>(cacheKey: string, rows: TRow[]): void {
	queryCache.set(cacheKey, {
		promise: Promise.resolve(rows),
		rows,
	});
}

function getLixInstanceId(lix: Lix): number {
	const asObject = lix as object;
	const cached = lixInstanceIds.get(asObject);
	if (cached !== undefined) {
		return cached;
	}
	const next = nextLixInstanceId++;
	lixInstanceIds.set(asObject, next);
	return next;
}

function getObserveQuery(
	cacheKey: string,
	compiled: {
		sql: string;
		parameters: ReadonlyArray<unknown>;
	},
): { sql: string; params: ReadonlyArray<unknown> } {
	const cached = observeQueryCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const next = {
		sql: compiled.sql,
		params: [...compiled.parameters],
	};
	observeQueryCache.set(cacheKey, next);
	return next;
}
