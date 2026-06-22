import { describe, expect, test } from "vitest";
import {
	isWorkspaceActiveDue,
	isWorkspaceProfileDue,
	sanitizeProperties,
} from "./telemetry.mjs";

const NOW = Date.UTC(2026, 5, 22);

describe("isWorkspaceActiveDue", () => {
	test("is due when no prior active timestamp exists", () => {
		expect(isWorkspaceActiveDue(undefined, NOW)).toBe(true);
	});

	test("is fresh inside the active throttle window", () => {
		expect(
			isWorkspaceActiveDue(new Date(NOW - 29 * 60 * 1000).toISOString(), NOW),
		).toBe(false);
	});

	test("is due once the active throttle window has elapsed", () => {
		expect(
			isWorkspaceActiveDue(new Date(NOW - 30 * 60 * 1000).toISOString(), NOW),
		).toBe(true);
	});
});

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
	test("allows workspace profile counts and workspace id", () => {
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
			}),
		).toEqual({
			workspace_id: "018f64f4-7d3c-7c2d-95d8-7e9625cfa211",
			file_count: 184,
			directory_count: 12,
			extension_count: 3,
			extension_counts: {
				md: 92,
				json: 41,
				none: 3,
				other: 12,
			},
			largest_extension: "md",
			largest_extension_file_count: 92,
			largest_extension_share: 0.5,
			view_kind: "other",
		});
	});

	test("drops path-like strings and invalid numeric values", () => {
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
			file_extension: "other",
			largest_extension: "other",
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
