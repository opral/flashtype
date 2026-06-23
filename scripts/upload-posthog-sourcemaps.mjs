import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const sourcemapDirectory = path.resolve("dist");
const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const releaseName = process.env.POSTHOG_RELEASE_NAME?.trim() || "flashtype";
const releaseVersion =
	process.env.POSTHOG_RELEASE_VERSION?.trim() || packageJson.version;
const isRequired = process.env.POSTHOG_SOURCEMAPS_REQUIRED === "1";

if (!(await pathExists(sourcemapDirectory))) {
	throw new Error(
		`Cannot upload PostHog source maps because ${sourcemapDirectory} does not exist. Run pnpm run build first.`,
	);
}

if (!hasPostHogSourcemapAuth()) {
	const message =
		"Skipping PostHog source map upload. Set POSTHOG_CLI_PROJECT_ID and POSTHOG_CLI_API_KEY to enable it.";
	if (isRequired) {
		throw new Error(message);
	}
	console.log(message);
	process.exit(0);
}

await runPostHogCli([
	"sourcemap",
	"inject",
	"--directory",
	sourcemapDirectory,
	"--release-name",
	releaseName,
	"--release-version",
	releaseVersion,
]);

await runPostHogCli([
	"sourcemap",
	"upload",
	"--directory",
	sourcemapDirectory,
	"--release-name",
	releaseName,
	"--release-version",
	releaseVersion,
	"--delete-after",
]);

function hasPostHogSourcemapAuth() {
	return Boolean(
		process.env.POSTHOG_CLI_PROJECT_ID?.trim() &&
		process.env.POSTHOG_CLI_API_KEY?.trim(),
	);
}

async function pathExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function runPostHogCli(args) {
	await new Promise((resolve, reject) => {
		const child = spawn("pnpm", ["exec", "posthog-cli", ...args], {
			stdio: "inherit",
			env: process.env,
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`posthog-cli ${args.join(" ")} exited with ${code}`));
		});
	});
}
