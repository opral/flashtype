import posthog, { type CaptureResult } from "posthog-js";

let activated = false;
let activationPromise: Promise<boolean> | null = null;
let sessionContextSynced = false;

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
		autocapture: false,
		capture_pageview: false,
		disable_session_recording: !config.sessionRecordingEnabled,
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
		scrubbableEvent.properties = scrubPostHogValue(
			scrubbableEvent.properties,
		) as ScrubbableCaptureResult["properties"];
	}
	return event;
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
