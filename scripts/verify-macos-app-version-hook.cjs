const { execFile } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

exports.default = async function verifyMacosAppVersionHook(context) {
	if (context.electronPlatformName !== "darwin") {
		return;
	}

	const appPath = path.join(context.appOutDir, "Flashtype.app");
	await verifyMacosAppVersion(appPath, context.packager.projectDir);
};

async function verifyMacosAppVersion(appPath, projectDir) {
	const packageJson = JSON.parse(
		await readFile(path.join(projectDir, "package.json"), "utf8"),
	);
	const expectedVersion = packageJson.version;
	if (!expectedVersion) {
		throw new Error("Missing version in package.json");
	}

	const infoPlistPath = path.join(appPath, "Contents/Info.plist");
	const [shortVersion, bundleVersion] = await Promise.all([
		readPlistValue(infoPlistPath, "CFBundleShortVersionString"),
		readPlistValue(infoPlistPath, "CFBundleVersion"),
	]);

	if (shortVersion !== expectedVersion || bundleVersion !== expectedVersion) {
		throw new Error(
			[
				"macOS app version metadata does not match package.json.",
				`App: ${appPath}`,
				`Expected: ${expectedVersion}`,
				`CFBundleShortVersionString: ${shortVersion}`,
				`CFBundleVersion: ${bundleVersion}`,
			].join("\n"),
		);
	}

	console.log(`Verified ${appPath} reports version ${expectedVersion}.`);
}

async function readPlistValue(infoPlistPath, key) {
	const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
		"-c",
		`Print :${key}`,
		infoPlistPath,
	]);
	return stdout.trim();
}
