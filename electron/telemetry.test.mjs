import { describe, expect, test } from "vitest";
import os from "node:os";
import {
	beforeSendTelemetryEvent,
	getDevelopmentTelemetryDistinctId,
	scrubTelemetrySensitiveValues,
	setTelemetrySessionContextForWebContents,
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
