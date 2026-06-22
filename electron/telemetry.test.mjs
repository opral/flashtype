import { describe, expect, test } from "vitest";
import os from "node:os";
import {
	beforeSendTelemetryEvent,
	isWorkspaceProfileDue,
	sanitizeProperties,
	scrubTelemetrySensitiveValues,
	setTelemetrySessionContextForWebContents,
} from "./telemetry.mjs";

const NOW = Date.UTC(2026, 5, 22);

describe("isWorkspaceProfileDue", () => {
	test("is due when no prior profile timestamp exists", () => {
		expect(isWorkspaceProfileDue(undefined, NOW)).toBe(true);
	});

	test("is fresh inside the seven day profile window", () => {
		expect(
			isWorkspaceProfileDue(new Date(Date.UTC(2026, 5, 16)).toISOString(), NOW),
		).toBe(false);
	});

	test("is due once the seven day profile window has elapsed", () => {
		expect(
			isWorkspaceProfileDue(new Date(Date.UTC(2026, 5, 15)).toISOString(), NOW),
		).toBe(true);
	});
});

describe("sanitizeProperties", () => {
	test("keeps simple telemetry values", () => {
		expect(
			sanitizeProperties({
				workspace_id: "018f64f4-7d3c-7c2d-95d8-7e9625cfa211",
				file_count: 184,
				directory_count: 12,
				extension_count: 3,
				extension_counts: {
					MD: 92,
					json: 41,
					none: 3,
					"customer/private": 9,
					too_long_private_customer_slug: 1,
					acmecustomer: 2,
					negative: -1,
					floaty: 1.2,
				},
				largest_extension: "MD",
				largest_extension_file_count: 92,
				largest_extension_share: 0.5,
				view_kind: "installed_notes",
				"bad/key": "dropped",
			}),
		).toEqual({
			workspace_id: "018f64f4-7d3c-7c2d-95d8-7e9625cfa211",
			file_count: 184,
			directory_count: 12,
			extension_count: 3,
			extension_counts: {
				MD: 92,
				json: 41,
				none: 3,
				too_long_private_customer_slug: 1,
				acmecustomer: 2,
				negative: -1,
				floaty: 1.2,
			},
			largest_extension: "MD",
			largest_extension_file_count: 92,
			largest_extension_share: 0.5,
			view_kind: "installed_notes",
		});
	});

	test("drops path-like strings", () => {
		expect(
			sanitizeProperties({
				source: "renderer",
				reason: "workspace_ready",
				file_extension: "customer/private",
				largest_extension: "acmecustomer",
				largest_extension_share: 1.2,
				file_count: -1,
				panel: "/Users/example/private",
			}),
		).toEqual({
			source: "renderer",
			reason: "workspace_ready",
			largest_extension: "acmecustomer",
			largest_extension_share: 1.2,
			file_count: -1,
		});
	});

	test("allows launch and workspace open source telemetry", () => {
		expect(
			sanitizeProperties({
				launch_source: "file",
				open_source: "file_open_event",
				pending_file_count: 1,
			}),
		).toEqual({
			launch_source: "file",
			open_source: "file_open_event",
			pending_file_count: 1,
		});
	});
});

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
