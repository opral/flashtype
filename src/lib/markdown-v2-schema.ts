import markdownBlockSchemaRaw from "../../submodule/lix/packages/plugin-md-v2/schema/markdown_block.json";
import markdownDocumentSchemaRaw from "../../submodule/lix/packages/plugin-md-v2/schema/markdown_document.json";

type SchemaDefinition = Record<string, unknown>;

function normalizeSchemaVersion(schema: SchemaDefinition): SchemaDefinition {
	const version = schema["x-lix-version"];
	if (typeof version !== "string") {
		return schema;
	}
	return {
		...schema,
		"x-lix-version": version,
	};
}

export const MARKDOWN_V2_DOCUMENT_SCHEMA =
	normalizeSchemaVersion(markdownDocumentSchemaRaw as SchemaDefinition);
export const MARKDOWN_V2_BLOCK_SCHEMA = normalizeSchemaVersion(
	markdownBlockSchemaRaw as SchemaDefinition,
);

export const MARKDOWN_V2_DOCUMENT_SCHEMA_KEY = String(
	MARKDOWN_V2_DOCUMENT_SCHEMA["x-lix-key"],
);
export const MARKDOWN_V2_BLOCK_SCHEMA_KEY = String(
	MARKDOWN_V2_BLOCK_SCHEMA["x-lix-key"],
);
export const MARKDOWN_V2_SCHEMA_VERSION = String(
	MARKDOWN_V2_DOCUMENT_SCHEMA["x-lix-version"],
);
export const MARKDOWN_V2_ROOT_ENTITY_ID = "root";

export type MarkdownV2DocumentSnapshot = {
	id: string;
	order: string[];
};

export type MarkdownV2BlockSnapshot = {
	id: string;
	type?: string;
	node: Record<string, unknown>;
	markdown?: string;
};

export const MARKDOWN_V2_SCHEMA_DEFINITIONS: SchemaDefinition[] = [
	MARKDOWN_V2_DOCUMENT_SCHEMA,
	MARKDOWN_V2_BLOCK_SCHEMA,
];
