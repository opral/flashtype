import { describe, expect, test } from "vitest";
import os from "node:os";
import {
	beforeSendTelemetryEvent,
	forgetTelemetrySessionContextForWebContents,
	getDevelopmentTelemetryDistinctId,
	scrubTelemetrySensitiveValues,
	setTelemetrySessionContextForWebContents,
	telemetryEventGroups,
	telemetryEventProperties,
} from "./telemetry.mjs";

describe("scrubTelemetrySensitiveValues", () => {
	test("redacts private file paths in nested exception properties", () => {
		const privateFilePath = `${os.homedir()}/Documents/customer/roadmap.md`;
		expect(
			scrubTelemetrySensitiveValues({
				$exception_list: [
					{
						value: `Failed to open ${privateFilePath}`,
						stacktrace: {
							frames: [
								{
									filename: `file://${privateFilePath}`,
								},
							],
						},
					},
				],
			}),
		).toEqual({
			$exception_list: [
				{
					value: "Failed to open [redacted_path]",
					stacktrace: {
						frames: [
							{
								filename: "[redacted_path]",
							},
						],
					},
				},
			],
		});
	});
});

describe("beforeSendTelemetryEvent", () => {
	test("does not overwrite an explicit exception session id with the latest renderer session", () => {
		const explicitSessionId = "11111111-1111-4111-8111-111111111111";
		const latestSessionId = "22222222-2222-4222-8222-222222222222";
		setTelemetrySessionContextForWebContents({ id: 42 }, latestSessionId);

		expect(
			beforeSendTelemetryEvent({
				event: "$exception",
				distinctId: "install-id",
				properties: {
					$session_id: explicitSessionId,
				},
			})?.properties?.$session_id,
		).toBe(explicitSessionId);
	});

	test("does not keep a closed window session as the latest renderer fallback", () => {
		forgetTelemetrySessionContextForWebContents({ id: 42 });
		const remainingWebContents = { id: 101 };
		const closedWebContents = { id: 202 };
		const remainingSessionId = "77777777-7777-4777-8777-777777777777";
		const closedSessionId = "88888888-8888-4888-8888-888888888888";
		setTelemetrySessionContextForWebContents(
			remainingWebContents,
			remainingSessionId,
		);
		setTelemetrySessionContextForWebContents(
			closedWebContents,
			closedSessionId,
		);

		forgetTelemetrySessionContextForWebContents(closedWebContents);

		expect(
			beforeSendTelemetryEvent({
				event: "$exception",
				distinctId: "install-id",
				properties: {},
			})?.properties?.$session_id,
		).toBe(remainingSessionId);

		forgetTelemetrySessionContextForWebContents(remainingWebContents);
		expect(
			beforeSendTelemetryEvent({
				event: "$exception",
				distinctId: "install-id",
				properties: {},
			})?.properties?.$session_id,
		).toBeUndefined();
	});
});

describe("telemetryEventProperties", () => {
	test("attaches the current renderer session id to product events", () => {
		const sessionId = "33333333-3333-4333-8333-333333333333";

		expect(
			telemetryEventProperties({ source: "renderer" }, { sessionId })
				.$session_id,
		).toBe(sessionId);
	});

	test("does not overwrite an explicit product event session id", () => {
		const explicitSessionId = "44444444-4444-4444-8444-444444444444";
		const fallbackSessionId = "55555555-5555-4555-8555-555555555555";

		expect(
			telemetryEventProperties(
				{ $session_id: explicitSessionId },
				{ sessionId: fallbackSessionId },
			).$session_id,
		).toBe(explicitSessionId);
	});

	test("replaces an invalid explicit session id with a valid renderer session id", () => {
		const fallbackSessionId = "66666666-6666-4666-8666-666666666666";

		expect(
			telemetryEventProperties(
				{ $session_id: "not-a-session-id" },
				{ sessionId: fallbackSessionId },
			).$session_id,
		).toBe(fallbackSessionId);
	});

	test("normalizes workspace id properties for grouped events", () => {
		expect(
			telemetryEventProperties({ workspace_id: " workspace-123 " })
				.workspace_id,
		).toBe("workspace-123");
	});

	test("drops path-like workspace ids from grouped events", () => {
		expect(
			telemetryEventProperties({ workspace_id: "/Users/sam/project" })
				.workspace_id,
		).toBeUndefined();
	});
});

describe("telemetryEventGroups", () => {
	test("derives the PostHog workspace group from workspace_id", () => {
		expect(telemetryEventGroups({ workspace_id: "workspace-123" })).toEqual({
			workspace: "workspace-123",
		});
	});

	test("does not derive a group for invalid workspace ids", () => {
		expect(
			telemetryEventGroups({ workspace_id: "/Users/sam/project" }),
		).toBeUndefined();
	});
});

describe("getDevelopmentTelemetryDistinctId", () => {
	test("uses a stable dev id when dev telemetry is explicitly enabled", () => {
		expect(
			getDevelopmentTelemetryDistinctId({
				isPackaged: false,
				enableDevTelemetry: "1",
			}),
		).toBe("dev:mode");
	});

	test("does not replace the install id for packaged builds", () => {
		expect(
			getDevelopmentTelemetryDistinctId({
				isPackaged: true,
				enableDevTelemetry: "1",
			}),
		).toBeUndefined();
	});

	test("does not enable telemetry identity in dev unless opted in", () => {
		expect(
			getDevelopmentTelemetryDistinctId({
				isPackaged: false,
				enableDevTelemetry: undefined,
			}),
		).toBeUndefined();
	});
});
