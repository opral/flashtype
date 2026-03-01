import type { Lix } from "@lix-js/sdk";
import { qb } from "@lix-js/kysely";
import { MARKDOWN_V2_SCHEMA_DEFINITIONS } from "./markdown-v2-schema";

type MarkdownSchemaDefinition = Record<string, unknown>;

function normalizeSchemaVersion(version: string): string {
	return version;
}

/**
 * Ensures all plugin-md-v2 schema definitions are stored in the current Lix.
 *
 * Seeds `lix_stored_schema_by_version` with any schema definitions that are not
 * already present for the `global` version. Existing definitions are left
 * untouched, allowing schema upgrades to append newer versions safely.
 *
 * @param lix - Active Lix instance to seed.
 *
 * @example
 * ```ts
 * await insertMarkdownSchemas({ lix });
 * ```
 */
export async function insertMarkdownSchemas(args: { lix: Lix }): Promise<void> {
	const { lix } = args;
	// TODO: remove `any` cast once @lix-js/kysely exports lix_stored_schema_by_version.
	const db = qb(lix) as any;

	const rows = (await db
		.selectFrom("lix_stored_schema_by_version")
		.select(["value"])
		.where("lixcol_version_id", "=", "global")
		.execute()) as Array<{ value: unknown }>;

	const existing = new Set<string>();
	for (const row of rows) {
		const raw = row.value;
		const parsed =
			typeof raw === "string"
				? (JSON.parse(raw) as Record<string, unknown>)
				: ((raw as Record<string, unknown>) ?? null);
		const schemaKey = parsed?.["x-lix-key"];
		const schemaVersionRaw = parsed?.["x-lix-version"];
		const schemaVersion =
			typeof schemaVersionRaw === "string"
				? normalizeSchemaVersion(schemaVersionRaw)
				: undefined;
		if (typeof schemaKey === "string" && typeof schemaVersion === "string") {
			existing.add(`${schemaKey}:${schemaVersion}`);
		}
	}

	const inserts: Array<{
		value: MarkdownSchemaDefinition;
		lixcol_version_id: "global";
	}> = [];

	for (const schema of MARKDOWN_V2_SCHEMA_DEFINITIONS) {
		const schemaKey = schema["x-lix-key"];
		const schemaVersionRaw = schema["x-lix-version"];
		const schemaVersion =
			typeof schemaVersionRaw === "string"
				? normalizeSchemaVersion(schemaVersionRaw)
				: undefined;
		if (typeof schemaKey !== "string" || typeof schemaVersion !== "string") {
			continue;
		}
		const fingerprint = `${schemaKey}:${schemaVersion}`;
		if (existing.has(fingerprint)) continue;
		existing.add(fingerprint);
		const normalizedSchema = {
			...schema,
			"x-lix-version": schemaVersion,
		} as MarkdownSchemaDefinition;
		inserts.push({
			value: normalizedSchema,
			lixcol_version_id: "global",
		});
	}

	if (inserts.length === 0) return;

	for (const insert of inserts) {
		await lix.execute(
			"INSERT INTO lix_stored_schema_by_version (value, lixcol_version_id) VALUES (lix_json(?1), ?2) ON CONFLICT (entity_id, file_id, version_id) DO NOTHING",
			[JSON.stringify(insert.value), insert.lixcol_version_id],
		);
	}
}
