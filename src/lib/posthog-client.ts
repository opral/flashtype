import posthog, { type CaptureResult } from "posthog-js";
import type { Lix } from "@/lib/lix-types";
import { readWorkspaceId } from "@/lib/workspace-profile-telemetry";

let activated = false;
let activationPromise: Promise<boolean> | null = null;
let sessionContextSynced = false;
let syncedWorkspaceGroupKey: string | null = null;

const AUTOCAPTURE_ATTRIBUTE_IGNORELIST = [
	"aria-label",
	"title",
	"href",
	"data-testid",
	"data-view-instance",
	"data-view-key",
];

export async function activatePostHogRecording() {
	if (activated) {
		return true;
	}
	activationPromise ??= activatePostHogRecordingUncached().finally(() => {
		activationPromise = null;
	});
	return await activationPromise;
}

async function activatePostHogRecordingUncached() {
	const config = await window.flashtypeDesktop?.telemetry?.getClientConfig();
	if (!config?.enabled) {
		return false;
	}

	posthog.init(config.token, {
		api_host: config.host,
		defaults: "2026-05-30",
		autocapture: {
			element_attribute_ignorelist: AUTOCAPTURE_ATTRIBUTE_IGNORELIST,
		},
		capture_pageview: false,
		disable_session_recording: !config.sessionRecordingEnabled,
		mask_all_text: true,
		before_send: (event) => scrubPostHogEvent(event),
		session_recording: {
			maskAllInputs: true,
			maskTextSelector: "*",
			blockSelector: ".ph-no-capture",
		},
	});
	posthog.register({
		surface: "electron_app",
		environment: config.environment,
		telemetry_environment: config.environment,
	});
	posthog.identify(config.distinctId);
	syncPostHogSessionContext();

	if (config.sessionRecordingEnabled) {
		posthog.startSessionRecording();
	}
	activated = true;
	return true;
}

export async function syncPostHogWorkspaceContext(lix: Lix) {
	const isActive = await activatePostHogRecording();
	if (!isActive) {
		return false;
	}
	const workspaceId = await readWorkspaceId(lix);
	if (!workspaceId || workspaceId === syncedWorkspaceGroupKey) {
		return Boolean(workspaceId);
	}
	syncedWorkspaceGroupKey = workspaceId;
	posthog.group("workspace", workspaceId, {
		workspace_id: workspaceId,
	});
	posthog.register({
		workspace_id: workspaceId,
	});
	return true;
}

function syncPostHogSessionContext() {
	if (sessionContextSynced) {
		return;
	}
	sessionContextSynced = true;
	const publishSessionId = (sessionId: string) => {
		if (!sessionId) {
			return;
		}
		void window.flashtypeDesktop?.telemetry?.setSessionContext({
			sessionId,
		});
	};
	publishSessionId(posthog.get_session_id());
	posthog.onSessionId((sessionId) => {
		publishSessionId(sessionId);
	});
}

type ScrubbableCaptureResult = CaptureResult & {
	properties?: unknown;
};

function scrubPostHogEvent(event: CaptureResult | null) {
	if (!event) {
		return event;
	}
	const scrubbableEvent = event as ScrubbableCaptureResult;
	if (scrubbableEvent.properties) {
		const safeProperties =
			(event as { event?: string }).event === "$autocapture"
				? scrubAutocaptureProperties(scrubbableEvent.properties)
				: scrubbableEvent.properties;
		scrubbableEvent.properties = scrubPostHogValue(
			safeProperties,
		) as ScrubbableCaptureResult["properties"];
	}
	return event;
}

function scrubAutocaptureProperties(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => scrubAutocaptureProperties(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const scrubbed: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		if (key === "$el_text" || key === "$external_click_url") {
			continue;
		}
		if (key.startsWith("attr__") && key !== "attr__data-attr") {
			continue;
		}
		scrubbed[key] = scrubAutocaptureProperties(nestedValue);
	}
	return scrubbed;
}

function scrubPostHogValue(value: unknown, depth = 0): unknown {
	if (depth > 8) {
		return undefined;
	}
	if (typeof value === "string") {
		return scrubPathLikeStrings(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => scrubPostHogValue(item, depth + 1));
	}
	if (value && typeof value === "object") {
		const scrubbed: Record<string, unknown> = {};
		for (const [key, nestedValue] of Object.entries(value)) {
			scrubbed[key] = scrubPostHogValue(nestedValue, depth + 1);
		}
		return scrubbed;
	}
	return value;
}

function scrubPathLikeStrings(value: string) {
	return value
		.replaceAll(/file:\/\/\/[^\s)"'<>[\]{}]+/g, "[redacted_path]")
		.replaceAll(
			/\/(?:Users|Volumes|private|tmp|var)\/[^\s)"'<>[\]{}]+/g,
			"[redacted_path]",
		)
		.replaceAll(/[A-Za-z]:\\[^\s)"'<>[\]{}]+/g, "[redacted_path]");
}
