import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";

const packagedAppPath = path.resolve("release/mac-arm64/Flashtype.app");
const installedAppPath = "/Applications/Flashtype.app";
const lsregisterPath =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

if (process.platform !== "darwin") {
	console.error("install:mac can only run on macOS.");
	process.exit(1);
}

try {
	await assertDirectory(
		packagedAppPath,
		`Packaged app not found at ${packagedAppPath}. Run pnpm run package:mac first.`,
	);

	console.log("Quitting Flashtype if it is running...");
	await run("/usr/bin/osascript", ["-e", 'quit app "Flashtype"'], {
		allowFailure: true,
		stdio: "ignore",
	});

	console.log(`Removing ${installedAppPath}...`);
	await rm(installedAppPath, { recursive: true, force: true });

	console.log(`Copying ${packagedAppPath} to ${installedAppPath}...`);
	await run("/usr/bin/ditto", [packagedAppPath, installedAppPath]);

	console.log("Refreshing Launch Services...");
	await run(lsregisterPath, ["-f", installedAppPath]);

	console.log("Verifying installed app version metadata...");
	await run(process.execPath, [
		path.resolve("scripts/verify-macos-app-version.mjs"),
		installedAppPath,
	]);

	console.log(`Opening ${installedAppPath}...`);
	await run("/usr/bin/open", [installedAppPath]);

	console.log(`Installed Flashtype at ${installedAppPath}.`);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

async function assertDirectory(directoryPath, message) {
	try {
		const stats = await stat(directoryPath);
		if (stats.isDirectory()) {
			return;
		}
	} catch {
		// Use the clearer caller-provided message below.
	}

	throw new Error(message);
}

function run(command, args, { allowFailure = false, stdio = "inherit" } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio });
		child.on("error", (error) => {
			if (allowFailure) {
				resolve();
				return;
			}
			reject(error);
		});
		child.on("exit", (code) => {
			if (code === 0 || allowFailure) {
				resolve();
				return;
			}
			reject(new Error(`${command} exited with code ${code ?? 1}`));
		});
	});
}
