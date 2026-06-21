import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");
const defaultAppPath = path.join(root, "release/mac-arm64/Flashtype.app");
const appPath = path.resolve(process.argv[2] ?? defaultAppPath);

if (process.platform !== "darwin") {
	console.error("verify-macos-app-version can only run on macOS.");
	process.exit(1);
}

try {
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
	const expectedVersion = packageJson.version;
	if (!expectedVersion) {
		throw new Error(`Missing version in ${packageJsonPath}`);
	}

	const infoPlistPath = path.join(appPath, "Contents/Info.plist");
	const [shortVersion, bundleVersion] = await Promise.all([
		readPlistValue(infoPlistPath, "CFBundleShortVersionString"),
		readPlistValue(infoPlistPath, "CFBundleVersion"),
	]);

	if (shortVersion !== expectedVersion || bundleVersion !== expectedVersion) {
		throw new Error(
			[
				`macOS app version metadata does not match package.json.`,
				`App: ${appPath}`,
				`Expected: ${expectedVersion}`,
				`CFBundleShortVersionString: ${shortVersion}`,
				`CFBundleVersion: ${bundleVersion}`,
			].join("\n"),
		);
	}

	console.log(`Verified ${appPath} reports version ${expectedVersion}.`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

async function readPlistValue(infoPlistPath, key) {
	const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
		"-c",
		`Print :${key}`,
		infoPlistPath,
	]);
	return stdout.trim();
}
