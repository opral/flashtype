import { useEffect } from "react";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

let initialized = false;
let initializationPromise: Promise<void> | null = null;

export function PostHogAnalytics() {
	useEffect(() => {
		initializePostHog();
	}, []);

	return null;
}

async function initializePostHog() {
	if (initialized) {
		return;
	}

	const token = import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN?.trim();
	if (!token) {
		return;
	}

	const host =
		import.meta.env.VITE_PUBLIC_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST;
	const environment = import.meta.env.PROD ? "production" : "dev";

	initializationPromise ??= initializePostHogClient(
		token,
		host,
		environment,
	).finally(() => {
		initializationPromise = null;
	});
	await initializationPromise;
}

async function initializePostHogClient(
	token: string,
	host: string,
	environment: "dev" | "production",
) {
	const { default: posthog } = await import("posthog-js");

	posthog.init(token, {
		api_host: host,
		defaults: "2026-05-30",
		capture_pageview: "history_change",
		capture_pageleave: true,
		autocapture: true,
		disable_session_recording: true,
		person_profiles: "identified_only",
		loaded: (client) => {
			client.register({
				surface: "website",
				environment,
				telemetry_environment: environment,
			});
		},
	});
	initialized = true;
}
