import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import {
	captureTelemetryThrottled,
	fileExtensionProperty,
	workspaceTelemetryProperties,
} from "@/lib/telemetry";
import { readWorkspaceId } from "@/lib/workspace-profile-telemetry";

export async function upsertMarkdownFile(args: {
	lix: Lix;
	fileId: string;
	markdown: string;
	path?: string;
	metadata?: any;
	createIfMissing?: boolean;
	originKey?: string;
}): Promise<void> {
	const {
		lix,
		fileId,
		markdown,
		path,
		metadata,
		createIfMissing = true,
		originKey,
	} = args;
	const data = new TextEncoder().encode(markdown);
	const db = qb(lix);

	const existing = await db
		.selectFrom("lix_file")
		.select(["id", "path", "lixcol_metadata"])
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (existing) {
		const resolvedPath = path ?? existing.path ?? `/${fileId}.md`;
		const resolvedMetadata = metadata ?? existing.lixcol_metadata ?? null;
		const updateValues: {
			data: Uint8Array;
			path?: string;
			lixcol_metadata?: any;
		} = { data };
		if (path !== undefined && resolvedPath !== existing.path) {
			updateValues.path = resolvedPath;
		}
		if (metadata !== undefined && metadata !== existing.lixcol_metadata) {
			updateValues.lixcol_metadata = resolvedMetadata;
		}
		await executeMarkdownFileWrite(
			lix,
			{
				sql: `UPDATE lix_file SET ${Object.keys(updateValues)
					.map((column) => `${column} = ?`)
					.join(", ")} WHERE id = ?`,
				params: [...Object.values(updateValues), fileId],
			},
			originKey,
		);
		captureDocumentModifiedTelemetry({ lix, fileId, filePath: resolvedPath });
	} else {
		if (!createIfMissing) return;
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await executeMarkdownFileWrite(
			lix,
			{
				sql: "INSERT INTO lix_file (id, path, data, lixcol_metadata) VALUES (?, ?, ?, ?)",
				params: [fileId, path ?? `/${fileId}.md`, data, metadata ?? null],
			},
			originKey,
		);
		captureDocumentModifiedTelemetry({
			lix,
			fileId,
			filePath: path ?? `/${fileId}.md`,
		});
	}
}

async function executeMarkdownFileWrite(
	lix: Lix,
	statement: { sql: string; params: ReadonlyArray<unknown> },
	originKey: string | undefined,
): Promise<void> {
	if (originKey) {
		await lix.execute(statement.sql, statement.params, { originKey });
		return;
	}
	await lix.execute(statement.sql, statement.params);
}

function captureDocumentModifiedTelemetry({
	lix,
	fileId,
	filePath,
}: {
	readonly lix: Lix;
	readonly fileId: string;
	readonly filePath: string;
}) {
	void (async () => {
		const workspaceId = await readWorkspaceId(lix);
		captureTelemetryThrottled(
			`document_modified:${fileId}`,
			"document_modified",
			{
				file_extension: fileExtensionProperty(filePath),
				modified_by: "user",
				source: "renderer",
				...workspaceTelemetryProperties(workspaceId),
			},
		);
	})().catch((error: unknown) => {
		console.warn("Failed to capture document_modified telemetry", error);
	});
}
