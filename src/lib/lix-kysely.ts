import {
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type CompiledQuery,
	type DatabaseConnection,
	type Driver,
	type ExpressionBuilder,
	type ExpressionWrapper,
	type QueryCompiler,
	type QueryResult,
	type SqlBool,
} from "kysely";
import type { ExecuteResult } from "@lix-js/sdk";
export { sql } from "kysely";
export { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/sqlite";

export type LixDatabaseSchema = Record<string, Record<string, any>>;

type LixQueryResult = ExecuteResult;

type LixExecuteLike = {
	execute(
		sql: string,
		params?: ReadonlyArray<unknown>,
	): Promise<LixQueryResult>;
};

type LixTransactionLike = {
	execute(
		sql: string,
		params?: ReadonlyArray<unknown>,
	): Promise<LixQueryResult>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
};

type LixTransactionalLike = LixExecuteLike & {
	beginTransaction(): Promise<LixTransactionLike>;
};

type LixDbLike = {
	db: unknown;
};

type LixLike = LixExecuteLike | LixDbLike;

class LixConnection implements DatabaseConnection {
	constructor(
		private readonly executeSql: (
			sql: string,
			params?: ReadonlyArray<unknown>,
		) => Promise<LixQueryResult>,
	) {}

	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		const raw = await this.executeSql(
			compiledQuery.sql,
			compiledQuery.parameters,
		);
		const columnNames =
			raw.columns.length > 0
				? raw.columns
				: columnNamesFromQueryNode(compiledQuery.query);
		const decodedRows = decodeRows(raw.rows, columnNames ?? raw.columns);
		const rows =
			columnNames &&
			decodedRows.every((row) => row.length === columnNames.length)
				? decodedRows.map((row) => rowToObject(row, columnNames))
				: decodedRows;

		const kind =
			compiledQuery.query && typeof compiledQuery.query === "object"
				? (compiledQuery.query as { kind?: unknown }).kind
				: undefined;

		return {
			rows: rows as R[],
			numAffectedRows:
				kind === "SelectQueryNode"
					? undefined
					: extractIntegerValue(raw.rowsAffected),
		};
	}

	async *streamQuery<R>(
		compiledQuery: CompiledQuery,
	): AsyncIterableIterator<QueryResult<R>> {
		yield await this.executeQuery(compiledQuery);
	}
}

class LixDriver implements Driver {
	private readonly connection: LixConnection;
	private transactionSlotHeld = false;
	private transaction: LixTransactionLike | undefined;
	private waiters: Array<() => void> = [];

	constructor(private readonly lix: LixExecuteLike) {
		this.connection = new LixConnection((sql, params) =>
			this.executeSql(sql, params),
		);
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return this.connection;
	}

	async beginTransaction(): Promise<void> {
		if (!isLixTransactionalLike(this.lix)) {
			throw new Error("This Lix handle does not support transactions");
		}
		await this.acquireTransactionSlot();
		try {
			this.transaction = await this.lix.beginTransaction();
		} catch (error) {
			this.releaseTransactionSlot();
			throw error;
		}
	}

	async commitTransaction(): Promise<void> {
		if (!this.transaction) {
			throw new Error("commitTransaction called without active transaction");
		}
		try {
			await this.transaction.commit();
		} finally {
			this.transaction = undefined;
			this.releaseTransactionSlot();
		}
	}

	async rollbackTransaction(): Promise<void> {
		if (!this.transaction) {
			throw new Error("rollbackTransaction called without active transaction");
		}
		try {
			await this.transaction.rollback();
		} finally {
			this.transaction = undefined;
			this.releaseTransactionSlot();
		}
	}

	async savepoint(
		_connection: DatabaseConnection,
		_savepointName: string,
		_compileQuery: QueryCompiler["compileQuery"],
	): Promise<void> {
		throw new Error("Nested Lix transactions are not supported");
	}

	async rollbackToSavepoint(
		_connection: DatabaseConnection,
		_savepointName: string,
		_compileQuery: QueryCompiler["compileQuery"],
	): Promise<void> {
		throw new Error("Nested Lix transactions are not supported");
	}

	async releaseSavepoint(
		_connection: DatabaseConnection,
		_savepointName: string,
		_compileQuery: QueryCompiler["compileQuery"],
	): Promise<void> {
		throw new Error("Nested Lix transactions are not supported");
	}

	async releaseConnection(): Promise<void> {}

	async destroy(): Promise<void> {}

	private async executeSql(
		sql: string,
		params?: ReadonlyArray<unknown>,
	): Promise<LixQueryResult> {
		if (this.transaction) {
			return this.transaction.execute(sql, params);
		}
		return this.lix.execute(sql, params);
	}

	private async acquireTransactionSlot(): Promise<void> {
		while (this.transactionSlotHeld) {
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		}
		this.transactionSlotHeld = true;
	}

	private releaseTransactionSlot(): void {
		this.transactionSlotHeld = false;
		this.waiters.shift()?.();
	}
}

class LixQueryCompiler extends SqliteQueryCompiler {
	protected override getLeftIdentifierWrapper(): string {
		return "";
	}

	protected override getRightIdentifierWrapper(): string {
		return "";
	}
}

const cache = new WeakMap<object, Map<string, Kysely<LixDatabaseSchema>>>();

export function createLixKysely(lix: LixLike): Kysely<LixDatabaseSchema> {
	if (isLixDbLike(lix)) {
		return lix.db as Kysely<LixDatabaseSchema>;
	}
	if (!isLixExecuteLike(lix)) {
		throw new TypeError(
			"createLixKysely requires either lix.execute(sql, params) or lix.db",
		);
	}

	const cacheKey = "__default__";
	const cached = cache.get(lix as object)?.get(cacheKey);
	if (cached) {
		return cached;
	}

	const dialect = {
		createAdapter: () => new SqliteAdapter(),
		createDriver: () => new LixDriver(lix),
		createIntrospector: (db: Kysely<any>) => new SqliteIntrospector(db),
		createQueryCompiler: () => new LixQueryCompiler(),
	};

	const db = new Kysely<LixDatabaseSchema>({ dialect });
	const entry = cache.get(lix as object);
	if (entry) {
		entry.set(cacheKey, db);
	} else {
		cache.set(lix as object, new Map([[cacheKey, db]]));
	}
	return db;
}

export const qb = (lix: LixLike) => createLixKysely(lix);

export function rawLixQuery<TRow>(
	lix: LixExecuteLike,
	sql: string,
	params: ReadonlyArray<unknown> = [],
): LixQueryLike<TRow> {
	return {
		compile() {
			return {
				sql,
				parameters: params,
			};
		},
		async execute(): Promise<TRow[]> {
			const raw = await lix.execute(sql, params);
			const columns = raw.columns;
			return decodeRows(raw.rows, columns).map((row) =>
				rowToObject(row, columns),
			) as TRow[];
		},
		async executeTakeFirst(): Promise<TRow | undefined> {
			return (await this.execute())[0];
		},
		async executeTakeFirstOrThrow(): Promise<TRow> {
			const row = await this.executeTakeFirst();
			if (row === undefined) {
				throw new Error("No result found");
			}
			return row;
		},
	};
}

export type LixQueryLike<TRow> = {
	compile(): {
		sql: string;
		parameters: ReadonlyArray<unknown>;
	};
	execute(): Promise<TRow[]>;
	executeTakeFirst(): Promise<TRow | undefined>;
	executeTakeFirstOrThrow(): Promise<TRow>;
};

type LixEntityPk = string[];
type LixEntityCanonical = {
	schema_key: string;
	file_id: string | null;
	entity_pk: LixEntityPk;
};
type LixEntity = {
	lixcol_schema_key: string;
	lixcol_file_id: string | null;
	lixcol_entity_pk: LixEntityPk;
};

const CANONICAL_TABLES = ["lix_state", "lix_state_by_branch"] as const;

export function ebEntity<
	TB extends keyof LixDatabaseSchema = keyof LixDatabaseSchema,
>(entityType?: TB) {
	const isCanonicalTable = entityType
		? CANONICAL_TABLES.includes(entityType as any)
		: undefined;

	const getColumnNames = (entity?: LixEntity | LixEntityCanonical) => {
		const useCanonical =
			entityType !== undefined
				? isCanonicalTable
				: Boolean(entity && "entity_pk" in entity);
		return {
			entityPkCol: useCanonical ? "entity_pk" : "lixcol_entity_pk",
			schemaKeyCol: useCanonical ? "schema_key" : "lixcol_schema_key",
			fileIdCol: useCanonical ? "file_id" : "lixcol_file_id",
		};
	};

	const getColumnRefs = (entity?: LixEntity | LixEntityCanonical) => {
		const { entityPkCol, schemaKeyCol, fileIdCol } = getColumnNames(entity);
		return {
			entityPkRef: entityType ? `${entityType}.${entityPkCol}` : entityPkCol,
			schemaKeyRef: entityType ? `${entityType}.${schemaKeyCol}` : schemaKeyCol,
			fileIdRef: entityType ? `${entityType}.${fileIdCol}` : fileIdCol,
		};
	};

	const getTargetValues = (entity: LixEntity | LixEntityCanonical) => ({
		targetEntityPk:
			"entity_pk" in entity ? entity.entity_pk : entity.lixcol_entity_pk,
		targetSchemaKey:
			"schema_key" in entity ? entity.schema_key : entity.lixcol_schema_key,
		targetFileId: "file_id" in entity ? entity.file_id : entity.lixcol_file_id,
	});

	const equalsExpression = (
		eb: ExpressionBuilder<LixDatabaseSchema, TB>,
		entity: LixEntity | LixEntityCanonical,
	): ExpressionWrapper<LixDatabaseSchema, TB, SqlBool> => {
		const { targetEntityPk, targetSchemaKey, targetFileId } =
			getTargetValues(entity);
		const { entityPkRef, schemaKeyRef, fileIdRef } = getColumnRefs(entity);
		return eb.and([
			eb(eb.ref(entityPkRef as any), "=", targetEntityPk),
			eb(eb.ref(schemaKeyRef as any), "=", targetSchemaKey),
			targetFileId === null
				? eb(eb.ref(fileIdRef as any), "is", null)
				: eb(eb.ref(fileIdRef as any), "=", targetFileId),
		]);
	};

	return {
		equals(entity: LixEntity | LixEntityCanonical) {
			return (eb: ExpressionBuilder<LixDatabaseSchema, TB>) =>
				equalsExpression(eb, entity);
		},
		in(entities: Array<LixEntityCanonical | LixEntity>) {
			return (eb: ExpressionBuilder<LixDatabaseSchema, TB>) => {
				if (entities.length === 0) {
					return eb.val(false);
				}
				return eb.or(entities.map((entity) => equalsExpression(eb, entity)));
			};
		},
		hasLabel(
			label: { id: string; name?: string } | { name: string; id?: string },
		) {
			return (
				eb: ExpressionBuilder<LixDatabaseSchema, TB>,
			): ExpressionWrapper<LixDatabaseSchema, TB, SqlBool> => {
				const { entityPkRef, schemaKeyRef, fileIdRef } = getColumnRefs();
				const labelQuery = eb
					.selectFrom("lix_label_assignment" as any)
					.innerJoin(
						"lix_label" as any,
						"lix_label.id" as any,
						"lix_label_assignment.label_id" as any,
					) as any;
				return eb.exists(
					labelQuery
						.select("lix_label_assignment.target_entity_pk" as any)
						.whereRef(
							"lix_label_assignment.target_entity_pk" as any,
							"=",
							entityPkRef as any,
						)
						.whereRef(
							"lix_label_assignment.target_schema_key" as any,
							"=",
							schemaKeyRef as any,
						)
						.whereRef(
							"lix_label_assignment.target_file_id" as any,
							"is",
							fileIdRef as any,
						)
						.$if("name" in label, (qb: any) =>
							qb.where("lix_label.name", "=", label.name!),
						)
						.$if("id" in label, (qb: any) =>
							qb.where("lix_label.id", "=", label.id!),
						),
				);
			};
		},
	};
}

function isLixExecuteLike(value: unknown): value is LixExecuteLike {
	return (
		Boolean(value) &&
		typeof (value as { execute?: unknown }).execute === "function"
	);
}

function isLixTransactionalLike(value: unknown): value is LixTransactionalLike {
	return (
		isLixExecuteLike(value) &&
		typeof (value as { beginTransaction?: unknown }).beginTransaction ===
			"function"
	);
}

function isLixDbLike(value: unknown): value is LixDbLike {
	return (
		value !== null &&
		typeof value === "object" &&
		"db" in value &&
		Boolean((value as { db?: unknown }).db)
	);
}

function decodeRows(
	rows: ExecuteResult["rows"],
	columns: string[],
): unknown[][] {
	return rows.map((row) => columns.map((column) => row.get(column)));
}

function extractIntegerValue(value: unknown): bigint | undefined {
	if (typeof value === "number" && Number.isInteger(value))
		return BigInt(value);
	if (typeof value === "bigint") return value;
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	return undefined;
}

function rowToObject(
	row: unknown[],
	columns: string[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (let index = 0; index < columns.length; index += 1) {
		const column = columns[index];
		if (column) out[column] = row[index];
	}
	return out;
}

function columnNamesFromQueryNode(queryNode: unknown): string[] | undefined {
	if (!queryNode || typeof queryNode !== "object") return undefined;
	const query = queryNode as Record<string, unknown>;
	const kind = typeof query.kind === "string" ? query.kind : "";
	if (kind === "SelectQueryNode") {
		const selections = selectSelectionNodes(query);
		return selections.length > 0
			? selections.map(selectionNameFromNode)
			: undefined;
	}
	if (
		kind === "InsertQueryNode" ||
		kind === "UpdateQueryNode" ||
		kind === "DeleteQueryNode"
	) {
		const returning = query.returning;
		if (returning && typeof returning === "object") {
			const selections = selectSelectionNodes(
				returning as Record<string, unknown>,
			);
			return selections.length > 0
				? selections.map(selectionNameFromNode)
				: undefined;
		}
	}
	return undefined;
}

function selectSelectionNodes(
	node: Record<string, unknown>,
): Record<string, unknown>[] {
	return Array.isArray(node.selections)
		? node.selections.filter(
				(selection): selection is Record<string, unknown> =>
					Boolean(selection) && typeof selection === "object",
			)
		: [];
}

function selectionNameFromNode(selectionNode: Record<string, unknown>): string {
	const selection = selectionNode.selection;
	if (!selection || typeof selection !== "object") return "column";
	return (
		identifierNameFromSelection(selection as Record<string, unknown>) ??
		"column"
	);
}

function identifierNameFromSelection(
	node: Record<string, unknown>,
): string | undefined {
	const kind = typeof node.kind === "string" ? node.kind : "";
	if (kind === "AliasNode") return identifierName(node.alias);
	if (kind === "ReferenceNode") {
		const column = node.column;
		if (!column || typeof column !== "object") return undefined;
		return identifierName((column as Record<string, unknown>).column);
	}
	if (kind === "ColumnNode") return identifierName(node.column);
	if (kind === "IdentifierNode") return identifierName(node);
	return undefined;
}

function identifierName(node: unknown): string | undefined {
	if (!node || typeof node !== "object") return undefined;
	const name = (node as Record<string, unknown>).name;
	return typeof name === "string" ? name : undefined;
}
