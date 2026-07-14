import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Lix } from "@/lib/lix-types";

const telemetry = vi.hoisted(() => ({
	capture: vi.fn(),
	captureThrottled: vi.fn(),
}));

vi.mock("@/lib/telemetry", () => ({
	captureTelemetry: telemetry.capture,
	captureTelemetryThrottled: telemetry.captureThrottled,
	fileExtensionProperty: (path: string) => path.split(".").pop() ?? "(none)",
	workspaceTelemetryProperties: (workspaceId?: string) =>
		workspaceId ? { workspace_id: workspaceId } : {},
}));

vi.mock("@/lib/workspace-profile-telemetry", () => ({
	readWorkspaceId: vi.fn(async () => "workspace-1"),
}));

import {
	createAgentPromptTelemetryHandler,
	createAtelierTelemetryHandler,
} from "./atelier-telemetry";

describe("createAtelierTelemetryHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("maps document and agent events to existing FlashType telemetry", async () => {
		const handle = createAtelierTelemetryHandler({} as Lix);
		handle({
			type: "document_viewed",
			filePath: "/notes/readme.md",
			documentOrigin: "existing",
			viewKind: "atelier_file",
		});
		handle({
			type: "extension_opened",
			extensionId: "flashtype_codex",
			panel: "right",
		});

		await vi.waitFor(() => {
			expect(telemetry.capture).toHaveBeenCalledWith("document_viewed", {
				document_origin: "existing",
				file_extension: "md",
				source: "renderer",
				view_kind: "atelier_file",
				workspace_id: "workspace-1",
			});
			expect(telemetry.capture).toHaveBeenCalledWith("agent_opened", {
				agent: "codex",
				panel: "right",
				source: "renderer",
				surface: "terminal",
				workspace_id: "workspace-1",
			});
		});
	});

	test("throttles document modifications and maps review outcomes", async () => {
		const handle = createAtelierTelemetryHandler({} as Lix);
		handle({
			type: "document_modified",
			filePath: "/notes/readme.md",
			modifiedBy: "user",
		});
		handle({
			type: "diff_resolved",
			reviewId: "review-1",
			filePath: "/notes/readme.md",
			outcome: "accepted",
		});

		await vi.waitFor(() => {
			expect(telemetry.captureThrottled).toHaveBeenCalledWith(
				"document_modified:/notes/readme.md",
				"document_modified",
				{
					file_extension: "md",
					modified_by: "user",
					source: "renderer",
					workspace_id: "workspace-1",
				},
			);
			expect(telemetry.capture).toHaveBeenCalledWith("diff_resolved", {
				diff_review_id: "review-1",
				file_extension: "md",
				outcome: "accepted",
				source: "renderer",
				workspace_id: "workspace-1",
			});
		});
	});

	test("counts prompt attempts per agent session", async () => {
		const handle = createAgentPromptTelemetryHandler({} as Lix);
		const event = {
			id: "event-1",
			agent: "claude" as const,
			phase: "turn-start" as const,
			sessionId: "session-1",
			createdAt: 1,
		};
		handle(event);
		handle({ ...event, id: "event-2", createdAt: 2 });

		await vi.waitFor(() => {
			expect(telemetry.capture).toHaveBeenNthCalledWith(1, "prompt_submitted", {
				agent: "claude",
				surface: "terminal",
				source: "agent_hook",
				attempt_number: 1,
				workspace_id: "workspace-1",
			});
			expect(telemetry.capture).toHaveBeenNthCalledWith(2, "prompt_submitted", {
				agent: "claude",
				surface: "terminal",
				source: "agent_hook",
				attempt_number: 2,
				workspace_id: "workspace-1",
			});
		});
	});
});
