import { app, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

const TELEMETRY_STORE_FILE = "telemetry.json";
const ENV_VARIABLES_FILE = "build/env-variables.mjs";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const SESSION_REPLAY_SAMPLE_RATE = 0.1;
const WORKSPACE_PROFILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

const RENDERER_EVENT_ALLOWLIST = new Set([
	"agent launched",
	"external write reviewed",
	"file created",
	"file opened",
	"file saved",
	"update installed",
	"workspace opened",
	"workspace profiled",
]);

let envVariablesPromise;
let telemetryStorePromise;
let telemetryStore;
let posthogClient;
let posthogClientPromise;
let telemetryIpcRegistered = false;
let telemetryShutdownStarted = false;
let latestRendererPostHogSessionId;
let cachedDistinctId;
const rendererPostHogSessionIdsByWebContentsId = new Map();

export async function captureAppLaunched({
	trigger = "launch",
	launchSource = "app",
} = {}) {
	return await captureTelemetryEvent("app launched", {
		trigger,
		launch_source: launchSource,
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
				...sanitizeProperties(properties),
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
		const eventName = normalizeRendererEventName(payload?.event);
		if (!eventName) {
			return { status: "ignored" };
		}
		return await captureTelemetryEvent(eventName, {
			...sanitizeProperties(payload?.properties),
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
			sessionRecordingEnabled: isDistinctIdSampled(
				distinctId,
				SESSION_REPLAY_SAMPLE_RATE,
			),
		};
	});

	ipcMain.handle("telemetry:setSessionContext", async (event, payload) => {
		return setTelemetrySessionContextForWebContents(
			event.sender,
			payload?.sessionId,
		);
	});

	ipcMain.handle(
		"telemetry:shouldProfileWorkspace",
		async (_event, payload) => {
			if (!isTelemetryEnabled()) {
				return { status: "disabled" };
			}
			if (!(await getPostHogClient())) {
				return { status: "disabled" };
			}
			const lixId = normalizeLixId(payload?.lixId);
			if (!lixId) {
				return { status: "ignored" };
			}
			const store = await getOrCreateTelemetryStore();
			const lastProfiledAt = store.workspaceProfiledAtByLixId?.[lixId];
			const now = Date.now();
			if (!isWorkspaceProfileDue(lastProfiledAt, now)) {
				return { status: "fresh" };
			}
			return { status: "due" };
		},
	);

	ipcMain.handle("telemetry:markWorkspaceProfiled", async (_event, payload) => {
		if (!isTelemetryEnabled()) {
			return { status: "disabled" };
		}
		const lixId = normalizeLixId(payload?.lixId);
		if (!lixId) {
			return { status: "ignored" };
		}
		const store = await getOrCreateTelemetryStore();
		store.workspaceProfiledAtByLixId = {
			...(store.workspaceProfiledAtByLixId ?? {}),
			[lixId]: new Date().toISOString(),
		};
		await persistTelemetryStore(store);
		return { status: "marked" };
	});
}

export async function shutdownTelemetry(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
	if (telemetryShutdownStarted) {
		return;
	}
	telemetryShutdownStarted = true;

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
	return (await getOrCreateTelemetryStore()).distinctId;
}

async function readEnvVariables() {
	if (envVariablesPromise) {
		return await envVariablesPromise;
	}
	envVariablesPromise = readEnvVariablesUncached();
	return await envVariablesPromise;
}

async function readEnvVariablesUncached() {
	const fileEnv = await readEnvVariablesFile();
	return {
		PUBLIC_POSTHOG_TOKEN:
			readProcessEnv("PUBLIC_POSTHOG_TOKEN", "POSTHOG_PROJECT_API_KEY") ??
			fileEnv?.PUBLIC_POSTHOG_TOKEN,
		PUBLIC_POSTHOG_HOST:
			readProcessEnv("PUBLIC_POSTHOG_HOST", "POSTHOG_HOST") ??
			fileEnv?.PUBLIC_POSTHOG_HOST,
	};
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

async function getOrCreateTelemetryStore() {
	if (telemetryStore) {
		return telemetryStore;
	}
	if (telemetryStorePromise) {
		return await telemetryStorePromise;
	}

	telemetryStorePromise = getOrCreateTelemetryStoreUncached();
	telemetryStore = await telemetryStorePromise;
	return telemetryStore;
}

async function getOrCreateTelemetryStoreUncached() {
	const userDataPath = app.getPath("userData");
	const storePath = path.join(userDataPath, TELEMETRY_STORE_FILE);

	await fs.mkdir(userDataPath, { recursive: true });
	const existingStore = await readTelemetryStore(storePath);
	if (existingStore?.distinctId) {
		return normalizeTelemetryStore(existingStore);
	}

	const store = {
		distinctId: randomUUID(),
		createdAt: new Date().toISOString(),
	};
	try {
		await writeTelemetryStore(storePath, store, { flag: "wx" });
		return store;
	} catch (error) {
		if (error?.code !== "EEXIST") {
			throw error;
		}
		const racedStore = await readTelemetryStore(storePath);
		if (racedStore?.distinctId) {
			return normalizeTelemetryStore(racedStore);
		}
		throw error;
	}
}

async function persistTelemetryStore(store) {
	const storePath = path.join(app.getPath("userData"), TELEMETRY_STORE_FILE);
	await writeTelemetryStore(storePath, store);
}

async function readTelemetryStore(storePath) {
	try {
		const rawStore = await fs.readFile(storePath, "utf8");
		const store = JSON.parse(rawStore);
		if (typeof store === "object" && store !== null) {
			return store;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

async function writeTelemetryStore(storePath, store, options = {}) {
	await fs.writeFile(
		storePath,
		`${JSON.stringify(normalizeTelemetryStore(store), null, 2)}\n`,
		options,
	);
}

function normalizeTelemetryStore(store) {
	const distinctId =
		typeof store?.distinctId === "string" && store.distinctId.length > 0
			? store.distinctId
			: randomUUID();
	return {
		distinctId,
		createdAt:
			typeof store?.createdAt === "string"
				? store.createdAt
				: new Date().toISOString(),
		workspaceProfiledAtByLixId: normalizeProfiledAtByLixId(
			store?.workspaceProfiledAtByLixId,
		),
	};
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
		...sanitizeProperties(properties),
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

function normalizeRendererEventName(event) {
	if (typeof event !== "string") {
		return undefined;
	}
	const trimmed = event.trim();
	return RENDERER_EVENT_ALLOWLIST.has(trimmed) ? trimmed : undefined;
}

export function sanitizeProperties(properties) {
	const sanitized = sanitizeTelemetryValue(properties);
	if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
		return {};
	}
	return sanitized;
}

function sanitizeTelemetryValue(value, depth = 0) {
	if (depth > 6 || value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "string") {
		return normalizeTelemetryString(value);
	}
	if (typeof value === "boolean" || typeof value === "number") {
		return Number.isFinite(value) || typeof value === "boolean"
			? value
			: undefined;
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeTelemetryValue(item, depth + 1))
			.filter((item) => item !== undefined)
			.slice(0, 50);
	}
	if (value && typeof value === "object") {
		const sanitized = {};
		for (const [rawKey, rawValue] of Object.entries(value)) {
			const key = normalizeTelemetryKey(rawKey);
			const sanitizedValue = sanitizeTelemetryValue(rawValue, depth + 1);
			if (key && sanitizedValue !== undefined) {
				sanitized[key] = sanitizedValue;
			}
		}
		return Object.keys(sanitized).length > 0 ? sanitized : undefined;
	}
	return undefined;
}

function normalizeTelemetryKey(key) {
	if (!/^[A-Za-z0-9_$][A-Za-z0-9_$.-]{0,79}$/.test(key)) {
		return undefined;
	}
	return key;
}

function normalizeTelemetryString(value) {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const scrubbed = scrubPrivatePaths(trimmed).slice(0, 200);
	if (
		!scrubbed ||
		scrubbed === "[redacted_path]" ||
		/[\\/]/.test(scrubbed)
	) {
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

function isDistinctIdSampled(distinctId, sampleRate) {
	if (sampleRate <= 0) {
		return false;
	}
	if (sampleRate >= 1) {
		return true;
	}
	let hash = 0x811c9dc5;
	for (let index = 0; index < distinctId.length; index += 1) {
		hash ^= distinctId.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) / 0x100000000 < sampleRate;
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

function normalizeLixId(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim().toLowerCase();
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
		trimmed,
	)
		? trimmed
		: undefined;
}

function normalizeProfiledAtByLixId(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const normalized = {};
	for (const [key, profiledAt] of Object.entries(value)) {
		const lixId = normalizeLixId(key);
		if (!lixId || typeof profiledAt !== "string") {
			continue;
		}
		normalized[lixId] = profiledAt;
	}
	return normalized;
}

export function isWorkspaceProfileDue(lastProfiledAt, now = Date.now()) {
	const lastProfiledTime = Date.parse(lastProfiledAt ?? "");
	return (
		!Number.isFinite(lastProfiledTime) ||
		now - lastProfiledTime >= WORKSPACE_PROFILE_INTERVAL_MS
	);
}
