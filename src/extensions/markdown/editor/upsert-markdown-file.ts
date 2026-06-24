import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { markFlashtypeMarkdownWrite } from "../external-write-tracking";
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
}): Promise<void> {
	const {
		lix,
		fileId,
		markdown,
		path,
		metadata,
		createIfMissing = true,
	} = args;
	const data = new TextEncoder().encode(markdown);
	const db = qb(lix);

	const existing = await db
		.selectFrom("lix_file")
		.select(["id", "path", "lixcol_metadata"])
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (existing) {
		markFlashtypeMarkdownWrite(fileId, markdown);
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
		await db
			.updateTable("lix_file")
			.set(updateValues)
			.where("id", "=", fileId)
			.execute();
		captureDocumentModifiedTelemetry({ lix, fileId, filePath: resolvedPath });
	} else {
		if (!createIfMissing) return;
		markFlashtypeMarkdownWrite(fileId, markdown);
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await db
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: path ?? `/${fileId}.md`,
				data,
				lixcol_metadata: metadata ?? null,
			})
			.execute();
		captureDocumentModifiedTelemetry({
			lix,
			fileId,
			filePath: path ?? `/${fileId}.md`,
		});
	}
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
