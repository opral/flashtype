import { createContext, use, useContext, useEffect, useState } from "react";
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

const queryPromiseCache = new Map<string, Promise<any>>();
const observeQueryCache = new Map<
	string,
	{ sql: string; params: ReadonlyArray<unknown> }
>();
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

	const cached = queryPromiseCache.get(cacheKey) as Promise<TRow[]> | undefined;
	const promise =
		cached ??
		(() => {
			const next = builder.execute();
			queryPromiseCache.set(cacheKey, next);
			return next;
		})();

	const initialRows = use(promise);
	const [rows, setRows] = useState(initialRows);

	useEffect(() => {
		setRows(initialRows);
	}, [cacheKey, initialRows]);

	useEffect(() => {
		if (!subscribe) return;
		let closed = false;
		const events = lix.observe(observeQuery);

		void (async () => {
			try {
				while (!closed) {
					const event = await events.next();
					if (closed || event === undefined) break;
					setRows(queryResultToRows<TRow>(event));
				}
			} catch (error) {
				if (closed) return;
				queryPromiseCache.delete(cacheKey);
				setRows(() => {
					throw error instanceof Error ? error : new Error(String(error));
				});
			}
		})();

		return () => {
			closed = true;
			events.close();
		};
	}, [cacheKey, subscribe, lix, observeQuery]);

	return subscribe ? rows : initialRows;
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
	rows?: ReadonlyArray<ReadonlyArray<unknown>>;
	columns?: ReadonlyArray<string>;
}): TRow[] {
	const columns = Array.isArray(result?.columns) ? result.columns : [];
	const rows = Array.isArray(result?.rows) ? result.rows : [];
	return rows.map((row) => {
		const output: Record<string, unknown> = {};
		for (let index = 0; index < columns.length; index += 1) {
			const column = columns[index];
			if (typeof column === "string") {
				output[column] = row[index];
			}
		}
		return output as TRow;
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
