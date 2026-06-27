import { afterEach, describe, expect, test, vi } from "vitest";
import posthog from "posthog-js";
import type { CaptureResult } from "posthog-js";
import type { Lix } from "@/lib/lix-types";
import { readWorkspaceId } from "@/lib/workspace-profile-telemetry";
import {
	activatePostHogRecording,
	syncPostHogWorkspaceContext,
} from "./posthog-client";

vi.mock("posthog-js", () => ({
	default: {
		init: vi.fn(),
		group: vi.fn(),
		register: vi.fn(),
		identify: vi.fn(),
		get_session_id: vi.fn(() => "session_123"),
		onSessionId: vi.fn(),
		startSessionRecording: vi.fn(),
	},
}));

vi.mock("@/lib/workspace-profile-telemetry", () => ({
	readWorkspaceId: vi.fn(),
}));

const originalDesktop = window.flashtypeDesktop;

afterEach(() => {
	window.flashtypeDesktop = originalDesktop;
	vi.clearAllMocks();
});

describe("activatePostHogRecording", () => {
	test("enables broad safe autocapture and syncs workspace context", async () => {
		vi.mocked(readWorkspaceId).mockResolvedValue("workspace_123");
		window.flashtypeDesktop = {
			...(originalDesktop ?? {}),
			telemetry: {
				...(originalDesktop?.telemetry ?? {}),
				capture: vi.fn().mockResolvedValue({ status: "queued" }),
				getClientConfig: vi.fn().mockResolvedValue({
					enabled: true,
					token: "phc_test",
					host: "https://us.i.posthog.com",
					distinctId: "user_123",
					environment: "dev",
					sessionRecordingEnabled: true,
				}),
				setSessionContext: vi.fn().mockResolvedValue(undefined),
			},
		} as Window["flashtypeDesktop"];

		await expect(activatePostHogRecording()).resolves.toBe(true);

		expect(posthog.init).toHaveBeenCalledWith(
			"phc_test",
			expect.objectContaining({
				api_host: "https://us.i.posthog.com",
				autocapture: {
					element_attribute_ignorelist: [
						"aria-label",
						"title",
						"href",
						"data-testid",
						"data-view-instance",
						"data-view-key",
					],
				},
				capture_pageview: false,
				disable_session_recording: false,
				mask_all_text: true,
				before_send: expect.any(Function),
				session_recording: {
					maskAllInputs: true,
					maskTextSelector: "*",
					blockSelector: ".ph-no-capture",
				},
			}),
		);

		const initOptions = vi.mocked(posthog.init).mock.calls[0]?.[1] as {
			before_send: (event: CaptureResult | null) => CaptureResult | null;
		};
		expect(
			initOptions.before_send({
				uuid: "event_123",
				event: "$autocapture",
				properties: {
					$el_text: "Customer roadmap",
					$external_click_url: "https://example.com/secret",
					"attr__aria-label": "Branch actions for secret-branch",
					"attr__data-testid": "file-tree-item-customers-roadmap-md",
					"attr__data-attr": "markdown-format-bold",
					$elements: [
						{
							$el_text: "roadmap.md",
							attr__title: "roadmap.md",
							"attr__data-attr": "file-tree",
						},
					],
				},
			})?.properties,
		).toEqual({
			"attr__data-attr": "markdown-format-bold",
			$elements: [
				{
					"attr__data-attr": "file-tree",
				},
			],
		});

		await expect(syncPostHogWorkspaceContext({} as Lix)).resolves.toBe(true);
		expect(posthog.group).toHaveBeenCalledWith("workspace", "workspace_123", {
			workspace_id: "workspace_123",
		});
		expect(posthog.register).toHaveBeenCalledWith(
			expect.objectContaining({
				workspace_id: "workspace_123",
			}),
		);
	});
});
