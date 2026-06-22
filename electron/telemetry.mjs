import { app, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";

const TELEMETRY_STORE_FILE = "telemetry.json";
const ENV_VARIABLES_FILE = "build/env-variables.mjs";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const SESSION_REPLAY_SAMPLE_RATE = 0.1;
const WORKSPACE_ACTIVE_THROTTLE_MS = 30 * 60 * 1000;
const WORKSPACE_PROFILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const WORKSPACE_PROFILE_CLAIM_TTL_MS = 5 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 2_000;

const RENDERER_EVENT_ALLOWLIST = new Set([
	"agent launched",
	"external write reviewed",
	"file created",
	"file opened",
	"file saved",
	"update installed",
	"workspace active",
	"workspace opened",
	"workspace profiled",
]);

const PROPERTY_ALLOWLIST = new Set([
	"agent",
	"branch_count",
	"directory_count",
	"extension_counts",
	"extension_kind",
	"extension_count",
	"file_extension",
	"file_count",
	"is_ephemeral_workspace",
	"largest_extension",
	"largest_extension_file_count",
	"largest_extension_share",
	"launch_source",
	"open_source",
	"outcome",
	"panel",
	"pending_file_count",
	"rank",
	"reason",
	"review_action",
	"share",
	"source",
	"trigger",
	"throttle_minutes",
	"view_kind",
	"workspace_id",
	"workspace_state",
]);

const SAFE_FILE_EXTENSIONS = new Set([
	"bash",
	"c",
	"cc",
	"cjs",
	"cpp",
	"cs",
	"css",
	"csv",
	"cxx",
	"doc",
	"docx",
	"env",
	"fish",
	"gif",
	"go",
	"gql",
	"graphql",
	"gz",
	"h",
	"htm",
	"html",
	"ini",
	"java",
	"jpeg",
	"jpg",
	"js",
	"json",
	"jsonl",
	"jsx",
	"kt",
	"kts",
	"lock",
	"markdown",
	"md",
	"mjs",
	"pdf",
	"php",
	"png",
	"ppt",
	"pptx",
	"py",
	"rb",
	"rs",
	"sh",
	"sql",
	"svg",
	"swift",
	"toml",
	"ts",
	"tsx",
	"tsv",
	"txt",
	"webp",
	"xls",
	"xlsx",
	"xml",
	"yaml",
	"yml",
	"zsh",
]);

const SAFE_VIEW_KINDS = new Set([
	"flashtype_csv",
	"flashtype_file",
	"flashtype_files",
	"flashtype_terminal",
]);

const SAFE_LAUNCH_SOURCES = new Set([
	"app",
	"file",
	"folder",
	"mixed",
	"unknown",
]);

const SAFE_WORKSPACE_OPEN_SOURCES = new Set([
	"app_restore",
	"file_launch",
	"file_open_event",
	"folder_launch",
	"open_in_new_window",
	"workspace_picker",
	"unknown",
]);

let envVariablesPromise;
let telemetryStorePromise;
let telemetryStore;
let posthogClient;
let posthogClientInitialized = false;
let identifiedThisSession = false;
let telemetryIpcRegistered = false;
let telemetryShutdownStarted = false;
const workspaceProfileClaimsByLixId = new Map();

export async function captureAppLaunched({
	trigger = "launch",
	launchSource = "app",
} = {}) {
	return await captureTelemetryEvent("app launched", {
		trigger,
		launch_source: launchSource,
	});
}

export async function captureWorkspaceActive({
	reason = "workspace_ready",
	source = "main",
	workspaceId,
} = {}) {
	if (!isTelemetryEnabled()) {
		return { status: "disabled" };
	}

	const store = await getOrCreateTelemetryStore();
	const normalizedWorkspaceId = normalizeLixId(workspaceId);
	const now = Date.now();
	const lastActiveAt = normalizedWorkspaceId
		? store.workspaceActiveAtByWorkspaceId?.[normalizedWorkspaceId]
		: store.lastWorkspaceActiveAt;
	if (!isWorkspaceActiveDue(lastActiveAt, now)) {
		return { status: "throttled" };
	}

	const result = await captureTelemetryEvent("workspace active", {
		reason,
		source,
		throttle_minutes: WORKSPACE_ACTIVE_THROTTLE_MS / 60_000,
		workspace_id: normalizedWorkspaceId,
	});
	if (result.status !== "queued") {
		return result;
	}

	const capturedAt = new Date(now).toISOString();
	if (normalizedWorkspaceId) {
		store.workspaceActiveAtByWorkspaceId = {
			...(store.workspaceActiveAtByWorkspaceId ?? {}),
			[normalizedWorkspaceId]: capturedAt,
		};
	} else {
		store.lastWorkspaceActiveAt = capturedAt;
	}
	await persistTelemetryStore(store);
	return result;
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
		await identifyTelemetryUser(client, distinctId);
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
		if (eventName === "workspace active") {
			return await captureWorkspaceActive({
				reason: normalizeShortString(payload?.properties?.reason),
				source: "renderer",
				workspaceId: payload?.properties?.workspace_id,
			});
		}
		return await captureTelemetryEvent(eventName, {
			...sanitizeProperties(payload?.properties),
			source: "renderer",
		});
	});

	ipcMain.handle("telemetry:getSessionRecordingConfig", async () => {
		if (!isTelemetryEnabled()) {
			return { enabled: false };
		}
		const env = await readEnvVariables();
		if (!env?.PUBLIC_POSTHOG_TOKEN) {
			return { enabled: false };
		}
		const distinctId = await getDistinctId();
		if (!isDistinctIdSampled(distinctId, SESSION_REPLAY_SAMPLE_RATE)) {
			return { enabled: false };
		}
		return {
			enabled: true,
			token: env.PUBLIC_POSTHOG_TOKEN,
			host: env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
			distinctId,
		};
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
			const claimedAt = workspaceProfileClaimsByLixId.get(lixId);
			if (
				typeof claimedAt === "number" &&
				now - claimedAt < WORKSPACE_PROFILE_CLAIM_TTL_MS
			) {
				return { status: "fresh" };
			}
			workspaceProfileClaimsByLixId.set(lixId, now);
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
		workspaceProfileClaimsByLixId.delete(lixId);
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
	if (posthogClientInitialized) {
		return posthogClient;
	}
	posthogClientInitialized = true;

	const env = await readEnvVariables();
	if (!env?.PUBLIC_POSTHOG_TOKEN) {
		return undefined;
	}

	posthogClient = new PostHog(env.PUBLIC_POSTHOG_TOKEN, {
		host: env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
		flushAt: 10,
		flushInterval: 10_000,
	});
	return posthogClient;
}

async function identifyTelemetryUser(client, distinctId) {
	if (identifiedThisSession) {
		return;
	}

	const store = await getOrCreateTelemetryStore();
	client.identify({
		distinctId,
		properties: {
			app_name: "flashtype",
			app_version: app.getVersion(),
			install_created_at: store.createdAt,
			is_packaged: app.isPackaged,
			platform: process.platform,
			platform_arch: process.arch,
			...systemLocaleProperties(),
			user_type: "active_install",
		},
	});
	identifiedThisSession = true;
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
		APP_VERSION: fileEnv?.APP_VERSION ?? app.getVersion(),
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
			APP_VERSION:
				typeof env.APP_VERSION === "string" ? env.APP_VERSION : undefined,
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
		lastWorkspaceActiveAt:
			typeof store?.lastWorkspaceActiveAt === "string"
				? store.lastWorkspaceActiveAt
				: undefined,
		workspaceActiveAtByWorkspaceId: normalizeWorkspaceActiveAtByWorkspaceId(
			store?.workspaceActiveAtByWorkspaceId,
		),
		workspaceProfiledAtByLixId: normalizeProfiledAtByLixId(
			store?.workspaceProfiledAtByLixId,
		),
	};
}

function commonEventProperties() {
	return {
		app_name: "flashtype",
		app_version: app.getVersion(),
		is_packaged: app.isPackaged,
		platform: process.platform,
		platform_arch: process.arch,
		...systemLocaleProperties(),
		telemetry_client: "electron-main",
		uptime_seconds: Math.floor(process.uptime()),
	};
}

function systemLocaleProperties() {
	const systemLocale =
		typeof app.getSystemLocale === "function"
			? app.getSystemLocale()
			: app.getLocale();
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
	if (typeof properties !== "object" || properties === null) {
		return {};
	}

	const sanitized = {};
	for (const [key, value] of Object.entries(properties)) {
		if (!PROPERTY_ALLOWLIST.has(key)) {
			continue;
		}
		const normalized = normalizePropertyValue(key, value);
		if (normalized !== undefined) {
			sanitized[key] = normalized;
		}
	}
	return sanitized;
}

function normalizePropertyValue(key, value) {
	switch (key) {
		case "extension_counts":
			return normalizeExtensionCounts(value);
		case "file_extension":
		case "largest_extension":
			return normalizeFileExtension(value);
		case "extension_kind":
		case "view_kind":
			return normalizeViewKind(value);
		case "launch_source":
			return normalizeStringFromSet(value, SAFE_LAUNCH_SOURCES);
		case "open_source":
			return normalizeStringFromSet(value, SAFE_WORKSPACE_OPEN_SOURCES);
		case "workspace_id":
			return normalizeLixId(value);
		case "largest_extension_share":
		case "share":
			return normalizeRatio(value);
		case "branch_count":
		case "directory_count":
		case "extension_count":
		case "file_count":
		case "largest_extension_file_count":
		case "pending_file_count":
		case "rank":
		case "throttle_minutes":
			return normalizeNonNegativeNumber(value);
		default:
			break;
	}
	if (typeof value === "string") {
		return normalizeSafeString(value);
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return undefined;
}

function normalizeExtensionCounts(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}

	const normalized = {};
	for (const [rawExtension, rawCount] of Object.entries(value)) {
		const extension = normalizeFileExtension(rawExtension);
		const count = normalizeNonNegativeInteger(rawCount);
		if (extension && count !== undefined) {
			normalized[extension] = (normalized[extension] ?? 0) + count;
		}
	}
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeFileExtension(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "none") {
		return normalized;
	}
	return SAFE_FILE_EXTENSIONS.has(normalized) ? normalized : "other";
}

function normalizeViewKind(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return SAFE_VIEW_KINDS.has(normalized) ? normalized : "other";
}

function normalizeStringFromSet(value, allowedValues) {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return allowedValues.has(normalized) ? normalized : "unknown";
}

function normalizeRatio(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return value >= 0 && value <= 1 ? value : undefined;
}

function normalizeNonNegativeNumber(value) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return value;
}

function normalizeNonNegativeInteger(value) {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		!Number.isInteger(value)
	) {
		return undefined;
	}
	return value;
}

function normalizeSafeString(value) {
	const normalized = normalizeShortString(value);
	if (!normalized) {
		return undefined;
	}
	return /[\\/]/.test(normalized) ? undefined : normalized;
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

function normalizeShortString(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.slice(0, 80);
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

function normalizeWorkspaceActiveAtByWorkspaceId(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const normalized = {};
	for (const [key, activeAt] of Object.entries(value)) {
		const workspaceId = normalizeLixId(key);
		if (!workspaceId || typeof activeAt !== "string") {
			continue;
		}
		normalized[workspaceId] = activeAt;
	}
	return normalized;
}

export function isWorkspaceActiveDue(lastActiveAt, now = Date.now()) {
	const lastActiveTime = Date.parse(lastActiveAt ?? "");
	return (
		!Number.isFinite(lastActiveTime) ||
		now - lastActiveTime >= WORKSPACE_ACTIVE_THROTTLE_MS
	);
}

export function isWorkspaceProfileDue(lastProfiledAt, now = Date.now()) {
	const lastProfiledTime = Date.parse(lastProfiledAt ?? "");
	return (
		!Number.isFinite(lastProfiledTime) ||
		now - lastProfiledTime >= WORKSPACE_PROFILE_INTERVAL_MS
	);
}
