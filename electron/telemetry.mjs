import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const TELEMETRY_STORE_FILE = "telemetry.json";
const TELEMETRY_STORE_LOCK = "telemetry.lock";
const ENV_VARIABLES_FILE = "build/env-variables.mjs";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const POSTHOG_CAPTURE_ENDPOINT = "/capture/";

export async function captureAppOpened() {
	if (!app.isPackaged) {
		return;
	}

	try {
		const env = await readEnvVariables();
		if (!env?.PUBLIC_POSTHOG_TOKEN) {
			return;
		}

		const distinctId = await getOrCreateDistinctId();
		const payload = {
			api_key: env.PUBLIC_POSTHOG_TOKEN,
			event: "app_opened",
			distinct_id: distinctId,
			properties: {
				app_version: env.APP_VERSION ?? app.getVersion(),
				platform: process.platform,
				is_packaged: app.isPackaged,
			},
		};

		const response = await fetch(
			new URL(
				POSTHOG_CAPTURE_ENDPOINT,
				env.PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
			),
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify(payload),
			},
		);

		if (!response.ok) {
			console.warn(`PostHog capture failed with status ${response.status}`);
		}
	} catch (error) {
		console.warn("PostHog capture failed", error);
	}
}

async function readEnvVariables() {
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
				typeof env.APP_VERSION === "string"
					? env.APP_VERSION
					: undefined,
		};
	} catch {
		return undefined;
	}
}

async function getOrCreateDistinctId() {
	const userDataPath = app.getPath("userData");
	const storePath = path.join(userDataPath, TELEMETRY_STORE_FILE);

	await fs.mkdir(userDataPath, { recursive: true });
	return await withTelemetryStoreLock(async () => {
		const existingDistinctId = await readDistinctId(storePath);
		if (existingDistinctId) {
			return existingDistinctId;
		}

		const distinctId = randomUUID();
		await fs.writeFile(
			storePath,
			`${JSON.stringify(
				{
					distinctId,
					createdAt: new Date().toISOString(),
				},
				null,
				2,
			)}\n`,
		);
		return distinctId;
	});
}

async function readDistinctId(storePath) {
	try {
		const rawStore = await fs.readFile(storePath, "utf8");
		const store = JSON.parse(rawStore);
		if (typeof store?.distinctId === "string" && store.distinctId.length > 0) {
			return store.distinctId;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

async function withTelemetryStoreLock(callback) {
	const lockPath = path.join(app.getPath("userData"), TELEMETRY_STORE_LOCK);
	await acquireTelemetryStoreLock(lockPath);
	try {
		return await callback();
	} finally {
		await fs.rm(lockPath, { force: true, recursive: true });
	}
}

async function acquireTelemetryStoreLock(lockPath) {
	const deadline = Date.now() + 2000;
	while (true) {
		try {
			await fs.mkdir(lockPath);
			return;
		} catch (error) {
			if (error?.code !== "EEXIST" || Date.now() >= deadline) {
				throw error;
			}
			await wait(25);
		}
	}
}

async function wait(milliseconds) {
	await new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}
