import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";

const packagedAppPath = path.resolve("release/mac-arm64/Flashtype.app");
const installedAppPath = "/Applications/Flashtype.app";
const installedAppProcessPathPrefix = `${installedAppPath}/Contents/`;
const lsregisterPath =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const quitTimeoutMs = 15_000;
const quitPollIntervalMs = 250;

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
	await waitForInstalledAppProcessesToExit();

	console.log(`Removing ${installedAppPath}...`);
	await rm(installedAppPath, { recursive: true, force: true });

	console.log(`Copying ${packagedAppPath} to ${installedAppPath}...`);
	await run("/usr/bin/ditto", [packagedAppPath, installedAppPath]);

	console.log("Refreshing Launch Services...");
	await run(lsregisterPath, ["-f", installedAppPath]);

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

async function waitForInstalledAppProcessesToExit() {
	const deadline = Date.now() + quitTimeoutMs;
	while (true) {
		const processes = await findInstalledAppProcesses();
		if (processes.length === 0) {
			return;
		}

		if (Date.now() >= deadline) {
			const processList = processes
				.map(({ pid, command }) => `${pid} ${command}`)
				.join("\n");
			throw new Error(
				`Timed out waiting for Flashtype to quit. Still running:\n${processList}`,
			);
		}

		await sleep(Math.min(quitPollIntervalMs, deadline - Date.now()));
	}
}

async function findInstalledAppProcesses() {
	const output = await capture("/bin/ps", ["-ww", "-axo", "pid=,command="]);
	const processes = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(.*)$/);
		if (!match) {
			continue;
		}
		const [, pid, command] = match;
		if (command.includes(installedAppProcessPathPrefix)) {
			processes.push({ pid, command });
		}
	}
	return processes;
}

function capture(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(
				new Error(
					`${command} exited with code ${code ?? 1}${stderr ? `: ${stderr}` : ""}`,
				),
			);
		});
	});
}

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
