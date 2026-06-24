import { describe, expect, test } from "vitest";
import { buildWorkspaceProfile } from "./workspace-profile-telemetry";

describe("buildWorkspaceProfile", () => {
	test("summarizes workspace file and extension composition", () => {
		const profile = buildWorkspaceProfile([
			"/README.md",
			"/docs/Guide.MD",
			"/data/accounts.csv",
			"/data/archive/accounts.CSV",
			"/config",
			"/src/app.tsx",
			"/.lix/app_data/private.md",
		]);

		expect(profile).toMatchObject({
			fileCount: 6,
			directoryCount: 4,
			extensionCount: 4,
			extensionCounts: {
				"(none)": 1,
				csv: 2,
				md: 2,
				tsx: 1,
			},
		});
	});

	test("returns zero counts for an empty or internal-only workspace", () => {
		const profile = buildWorkspaceProfile([
			"/.lix/app_data/extension.json",
			"relative.md",
		]);

		expect(profile).toEqual({
			fileCount: 0,
			directoryCount: 0,
			extensionCount: 0,
			extensionCounts: {},
		});
	});

	test("groups malformed or very long extensions as other", () => {
		const profile = buildWorkspaceProfile([
			"/exports/customer-name-with-private-suffix",
			"/exports/data.customernameprojectslug",
			"/exports/archive.tar.gz",
		]);

		expect(profile.extensionCounts).toEqual({
			"(none)": 1,
			gz: 1,
			other: 1,
		});
	});
});
