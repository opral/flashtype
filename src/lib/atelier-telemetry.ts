import type { AtelierEvent } from "@opral/atelier";
import type { Lix } from "@/lib/lix-types";
import {
	captureTelemetry,
	captureTelemetryThrottled,
	fileExtensionProperty,
	workspaceTelemetryProperties,
} from "@/lib/telemetry";
import { readWorkspaceId } from "@/lib/workspace-profile-telemetry";

const AGENT_BY_EXTENSION_ID = {
	flashtype_claude: "claude",
	flashtype_codex: "codex",
} as const;

export function createAtelierTelemetryHandler(lix: Lix) {
	let workspaceIdPromise: Promise<string | undefined> | null = null;
	const workspaceProperties = async () => {
		workspaceIdPromise ??= readWorkspaceId(lix);
		return workspaceTelemetryProperties(await workspaceIdPromise);
	};

	return (event: AtelierEvent): void => {
		void (async () => {
			const workspace = await workspaceProperties();
			switch (event.type) {
				case "document_open_attempted": {
					const fileExtension = fileExtensionProperty(event.filePath);
					captureTelemetry("document_open_attempted", {
						document_open_result: event.supported ? "viewed" : "unsupported",
						file_extension: fileExtension,
						...(event.supported
							? {}
							: {
									unsupported_reason:
										fileExtension === "(none)" ? "no_extension" : "no_renderer",
								}),
						document_origin: event.documentOrigin,
						source: "renderer",
						view_kind: event.viewKind,
						...workspace,
					});
					break;
				}
				case "document_viewed":
					captureTelemetry("document_viewed", {
						document_origin: event.documentOrigin,
						file_extension: fileExtensionProperty(event.filePath),
						source: "renderer",
						view_kind: event.viewKind,
						...workspace,
					});
					break;
				case "document_modified":
					captureTelemetryThrottled(
						`document_modified:${event.filePath}`,
						"document_modified",
						{
							file_extension: fileExtensionProperty(event.filePath),
							modified_by: event.modifiedBy,
							source: "renderer",
							...workspace,
						},
					);
					break;
				case "extension_opened": {
					const agent =
						AGENT_BY_EXTENSION_ID[
							event.extensionId as keyof typeof AGENT_BY_EXTENSION_ID
						];
					if (!agent) break;
					captureTelemetry("agent_opened", {
						agent,
						panel: event.panel,
						source: "renderer",
						surface: "terminal",
						...workspace,
					});
					break;
				}
				case "diff_opened":
					captureTelemetry("diff_opened", {
						diff_review_id: event.reviewId,
						file_extension: fileExtensionProperty(event.filePath),
						source: "renderer",
						...workspace,
					});
					break;
				case "diff_resolved":
					captureTelemetry("diff_resolved", {
						diff_review_id: event.reviewId,
						file_extension: fileExtensionProperty(event.filePath),
						outcome: event.outcome,
						source: "renderer",
						...workspace,
					});
					break;
			}
		})().catch((error: unknown) => {
			console.warn("Failed to capture Atelier telemetry", error);
		});
	};
}

export function createAgentPromptTelemetryHandler(lix: Lix) {
	const attempts = new Map<string, number>();
	let workspaceIdPromise: Promise<string | undefined> | null = null;
	return (
		event: Parameters<
			NonNullable<Window["flashtypeDesktop"]>["agentHooks"]["onTurnEvent"]
		>[0] extends (event: infer Event) => unknown
			? Event
			: never,
	): void => {
		if (event.phase !== "turn-start") return;
		const key = [
			event.instanceId ?? "unknown-instance",
			event.agent,
			event.sessionId ?? event.cwd ?? "unknown-session",
		].join(":");
		const attemptNumber = (attempts.get(key) ?? 0) + 1;
		attempts.set(key, attemptNumber);
		void (async () => {
			workspaceIdPromise ??= readWorkspaceId(lix);
			captureTelemetry("prompt_submitted", {
				agent: event.agent,
				surface: "terminal",
				source: "agent_hook",
				attempt_number: attemptNumber,
				...workspaceTelemetryProperties(await workspaceIdPromise),
			});
		})().catch((error: unknown) => {
			console.warn("Failed to capture prompt telemetry", error);
		});
	};
}
