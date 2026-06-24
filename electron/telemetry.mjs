import { app, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

const TELEMETRY_STORE_FILE = "telemetry.json";
const ENV_VARIABLES_FILE = "build/env-variables.mjs";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DEV_TELEMETRY_DISTINCT_ID = "dev:mode";
const SHUTDOWN_TIMEOUT_MS = 2_000;

let envVariablesPromise;
let distinctIdPromise;
let posthogClient;
let posthogClientPromise;
let telemetryIpcRegistered = false;
let telemetryShutdownPromise;
let latestRendererPostHogSessionId;
let cachedDistinctId;
const rendererPostHogSessionIdsByWebContentsId = new Map();

export async function captureAppOpened({ entryPoint = "app_direct" } = {}) {
	return await captureTelemetryEvent("app_opened", {
		entry_point: entryPoint,
	});
}

export async function captureTelemetryEvent(event, properties = {}) {
	if (!isTelemetryEnabled()) {
		return { status: "disabled" };
	}

	try {
		const client = await getPostHogClient();
		if (!client) {
			return { status: "disabled" };
		}

		const distinctId = await getDistinctId();
		client.capture({
			distinctId,
			event,
			properties: {
				...commonEventProperties(),
				...properties,
			},
		});
		return { status: "queued" };
	} catch (error) {
		console.warn("PostHog capture failed", error);
		return { status: "error" };
	}
}

export async function captureTelemetryException(error, properties = {}) {
	if (!isTelemetryEnabled()) {
		return { status: "disabled" };
	}

	try {
		const client = await getPostHogClient();
		if (!client) {
			return { status: "disabled" };
		}

		const distinctId = await getDistinctId();
		client.captureException(
			error,
			distinctId,
			exceptionEventProperties(properties, {
				sessionId:
					normalizePostHogSessionId(properties?.sessionId) ??
					latestRendererPostHogSessionId,
			}),
		);
		return { status: "queued" };
	} catch (captureError) {
		console.warn("PostHog exception capture failed", captureError);
		return { status: "error" };
	}
}

export function registerTelemetryIpc() {
	if (telemetryIpcRegistered) {
		return;
	}
	telemetryIpcRegistered = true;

	ipcMain.handle("telemetry:capture", async (_event, payload) => {
		const eventName = normalizeTelemetryString(payload?.event);
		if (!eventName) {
			return { status: "ignored" };
		}
		return await captureTelemetryEvent(eventName, {
			...(payload?.properties ?? {}),
			source: "renderer",
		});
	});

	ipcMain.handle("telemetry:getClientConfig", async () => {
		if (!isTelemetryEnabled()) {
			return { enabled: false };
		}
		const env = await readEnvVariables();
		if (!env?.PUBLIC_POSTHOG_TOKEN) {
			return { enabled: false };
		}
		const distinctId = await getDistinctId();
		return {
			enabled: true,
			token: env.PUBLIC_POSTHOG_TOKEN,
			host: env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
			distinctId,
			sessionRecordingEnabled: true,
		};
	});

	ipcMain.handle("telemetry:setSessionContext", async (event, payload) => {
		return setTelemetrySessionContextForWebContents(
			event.sender,
			payload?.sessionId,
		);
	});
}

export async function shutdownTelemetry(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
	telemetryShutdownPromise ??= shutdownTelemetryUncached(timeoutMs);
	return await telemetryShutdownPromise;
}

async function shutdownTelemetryUncached(timeoutMs) {
	try {
		if (posthogClient) {
			await posthogClient.shutdown(timeoutMs);
		}
	} catch (error) {
		console.warn("PostHog shutdown failed", error);
	}
}

function isTelemetryEnabled() {
	return app.isPackaged || process.env.FLASHTYPE_ENABLE_DEV_TELEMETRY === "1";
}

async function getPostHogClient() {
	if (posthogClient) {
		return posthogClient;
	}
	posthogClientPromise ??= createPostHogClient().finally(() => {
		posthogClientPromise = undefined;
	});
	return await posthogClientPromise;
}

async function createPostHogClient() {
	const env = await readEnvVariables();
	if (!env?.PUBLIC_POSTHOG_TOKEN) {
		return undefined;
	}
	cachedDistinctId = await getDistinctId();

	posthogClient = new PostHog(env.PUBLIC_POSTHOG_TOKEN, {
		host: env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
		flushAt: 10,
		flushInterval: 10_000,
		enableExceptionAutocapture: true,
		before_send: (event) => beforeSendTelemetryEvent(event),
	});
	return posthogClient;
}

async function getDistinctId() {
	if (cachedDistinctId) {
		return cachedDistinctId;
	}
	const developmentDistinctId = getDevelopmentTelemetryDistinctId({
		isPackaged: app.isPackaged === true,
		enableDevTelemetry: process.env.FLASHTYPE_ENABLE_DEV_TELEMETRY,
	});
	if (developmentDistinctId) {
		cachedDistinctId = developmentDistinctId;
		return cachedDistinctId;
	}
	distinctIdPromise ??= readOrCreateDistinctId().finally(() => {
		distinctIdPromise = undefined;
	});
	cachedDistinctId = await distinctIdPromise;
	return cachedDistinctId;
}

export function getDevelopmentTelemetryDistinctId({
	isPackaged,
	enableDevTelemetry,
}) {
	if (isPackaged === true) {
		return undefined;
	}
	return enableDevTelemetry === "1" ? DEV_TELEMETRY_DISTINCT_ID : undefined;
}

async function readEnvVariables() {
	if (envVariablesPromise) {
		return await envVariablesPromise;
	}
	envVariablesPromise = (async () => {
		const fileEnv = await readEnvVariablesFile();
		return {
			PUBLIC_POSTHOG_TOKEN:
				readProcessEnv("PUBLIC_POSTHOG_TOKEN", "POSTHOG_PROJECT_API_KEY") ??
				fileEnv?.PUBLIC_POSTHOG_TOKEN,
			PUBLIC_POSTHOG_HOST:
				readProcessEnv("PUBLIC_POSTHOG_HOST", "POSTHOG_HOST") ??
				fileEnv?.PUBLIC_POSTHOG_HOST,
		};
	})();
	return await envVariablesPromise;
}

async function readEnvVariablesFile() {
	try {
		const envFileUrl = new URL(
			path.join(app.getAppPath(), ENV_VARIABLES_FILE),
			"file:",
		);
		const module = await import(envFileUrl.href);
		const env = module.ENV_VARIABLES;
		if (typeof env !== "object" || env === null) {
			return undefined;
		}

		return {
			PUBLIC_POSTHOG_TOKEN:
				typeof env.PUBLIC_POSTHOG_TOKEN === "string"
					? env.PUBLIC_POSTHOG_TOKEN
					: undefined,
			PUBLIC_POSTHOG_HOST:
				typeof env.PUBLIC_POSTHOG_HOST === "string"
					? env.PUBLIC_POSTHOG_HOST
					: undefined,
		};
	} catch {
		return undefined;
	}
}

function readProcessEnv(...names) {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

async function readOrCreateDistinctId() {
	const userDataPath = app.getPath("userData");
	const storePath = path.join(userDataPath, TELEMETRY_STORE_FILE);

	await fs.mkdir(userDataPath, { recursive: true });
	const existingDistinctId = await readDistinctId(storePath);
	if (existingDistinctId) {
		return existingDistinctId;
	}

	const distinctId = randomUUID();
	try {
		await writeDistinctId(storePath, distinctId, { flag: "wx" });
		return distinctId;
	} catch (error) {
		if (error?.code !== "EEXIST") {
			throw error;
		}
		return (await readDistinctId(storePath)) ?? distinctId;
	}
}

async function readDistinctId(storePath) {
	try {
		const rawStore = await fs.readFile(storePath, "utf8");
		const store = JSON.parse(rawStore);
		return typeof store?.distinctId === "string" && store.distinctId.length > 0
			? store.distinctId
			: undefined;
	} catch {
		return undefined;
	}
}

async function writeDistinctId(storePath, distinctId, options = {}) {
	await fs.writeFile(
		storePath,
		`${JSON.stringify({ distinctId }, null, 2)}\n`,
		options,
	);
}

function commonEventProperties() {
	return {
		app_name: "flashtype",
		app_version:
			typeof app?.getVersion === "function" ? app.getVersion() : "0.0.0",
		is_packaged: app?.isPackaged === true,
		platform: process.platform,
		platform_arch: process.arch,
		...systemLocaleProperties(),
		schema_version: 2,
		telemetry_environment: app?.isPackaged === true ? "production" : "dev",
		telemetry_client: "electron-main",
		uptime_seconds: Math.floor(process.uptime()),
	};
}

export function getTelemetrySessionIdForWebContents(webContents) {
	return rendererPostHogSessionIdsByWebContentsId.get(webContents?.id);
}

export function forgetTelemetrySessionContextForWebContents(webContents) {
	if (!webContents) {
		return;
	}
	rendererPostHogSessionIdsByWebContentsId.delete(webContents.id);
}

export function setTelemetrySessionContextForWebContents(
	webContents,
	sessionIdValue,
) {
	const sessionId = normalizePostHogSessionId(sessionIdValue);
	if (!sessionId || !webContents) {
		return { status: "ignored" };
	}
	latestRendererPostHogSessionId = sessionId;
	rendererPostHogSessionIdsByWebContentsId.set(webContents.id, sessionId);
	return { status: "set" };
}

function exceptionEventProperties(properties = {}, { sessionId } = {}) {
	const normalizedSessionId = normalizePostHogSessionId(sessionId);
	return {
		...commonEventProperties(),
		...properties,
		...(normalizedSessionId ? { $session_id: normalizedSessionId } : {}),
	};
}

export function beforeSendTelemetryEvent(event) {
	if (!event) {
		return event;
	}

	if (event.event === "$exception") {
		if (cachedDistinctId) {
			event.distinctId = cachedDistinctId;
		}
		const existingSessionId = normalizePostHogSessionId(
			event.properties?.$session_id,
		);
		const sessionId = existingSessionId ?? latestRendererPostHogSessionId;
		event.properties = {
			...exceptionEventProperties({ source: "electron-main" }, { sessionId }),
			...(event.properties ?? {}),
		};
	}

	if (event.properties) {
		event.properties = scrubTelemetrySensitiveValues(event.properties);
	}
	return event;
}

function systemLocaleProperties() {
	const systemLocale =
		typeof app?.getSystemLocale === "function"
			? app.getSystemLocale()
			: app?.getLocale?.();
	const locale = normalizeLocale(systemLocale);
	const language = locale?.split(/[-_]/)[0]?.toLowerCase();
	const properties = {};
	if (locale) {
		properties.system_locale = locale;
	}
	if (language) {
		properties.system_language = language;
	}
	return properties;
}

function normalizeTelemetryString(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const scrubbed = scrubPrivatePaths(trimmed).slice(0, 200);
	if (!scrubbed || scrubbed === "[redacted_path]" || /[\\/]/.test(scrubbed)) {
		return undefined;
	}
	return scrubbed;
}

function normalizeLocale(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(trimmed)
		? trimmed
		: undefined;
}

function normalizePostHogSessionId(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
		trimmed,
	)
		? trimmed
		: undefined;
}

export function scrubTelemetrySensitiveValues(value, depth = 0) {
	if (depth > 8) {
		return undefined;
	}
	if (typeof value === "string") {
		return scrubPrivatePaths(value);
	}
	if (Array.isArray(value)) {
		return value.map((item) => scrubTelemetrySensitiveValues(item, depth + 1));
	}
	if (value && typeof value === "object") {
		const scrubbed = {};
		for (const [key, nestedValue] of Object.entries(value)) {
			scrubbed[key] = scrubTelemetrySensitiveValues(nestedValue, depth + 1);
		}
		return scrubbed;
	}
	return value;
}

function scrubPrivatePaths(value) {
	return value
		.replaceAll(/file:\/\/\/[^\s)"'<>[\]{}]+/g, "[redacted_path]")
		.replaceAll(
			/\/(?:Users|Volumes|home|private|tmp|var)\/[^\s)"'<>[\]{}]+/g,
			"[redacted_path]",
		)
		.replaceAll(/[A-Za-z]:\\[^\s)"'<>[\]{}]+/g, "[redacted_path]");
}
