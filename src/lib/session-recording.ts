import posthog from "posthog-js";

let sessionRecordingStarted = false;
let sessionRecordingStartPromise: Promise<void> | null = null;

export async function startPostHogSessionRecording() {
	if (sessionRecordingStarted) {
		return;
	}
	if (sessionRecordingStartPromise) {
		return await sessionRecordingStartPromise;
	}

	sessionRecordingStartPromise = startPostHogSessionRecordingUncached();
	try {
		await sessionRecordingStartPromise;
	} finally {
		sessionRecordingStartPromise = null;
	}
}

async function startPostHogSessionRecordingUncached() {
	const config =
		await window.flashtypeDesktop?.telemetry?.getSessionRecordingConfig();
	if (!config?.enabled) {
		return;
	}

	posthog.init(config.token, {
		api_host: config.host,
		defaults: "2026-05-30",
		autocapture: false,
		capture_pageview: false,
		disable_session_recording: true,
		session_recording: {
			maskAllInputs: true,
			maskTextSelector: ".ph-mask",
		},
	});
	posthog.identify(config.distinctId);
	posthog.startSessionRecording();
	sessionRecordingStarted = true;
}
