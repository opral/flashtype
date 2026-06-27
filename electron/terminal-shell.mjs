const LOGIN_SHELLS = new Set([
	"bash",
	"csh",
	"dash",
	"fish",
	"ksh",
	"sh",
	"tcsh",
	"zsh",
]);

const PATH_ENTRIES_BY_PLATFORM = {
	darwin: [
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/local/sbin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	],
	default: [
		"/usr/local/bin",
		"/usr/local/sbin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	],
};

export function resolveShell(
	rawShell,
	env = process.env,
	platform = process.platform,
) {
	if (typeof rawShell === "string" && rawShell.trim().length > 0) {
		return rawShell.trim();
	}
	if (platform === "win32") {
		return env.COMSPEC ?? "powershell.exe";
	}
	return env.SHELL ?? "/bin/zsh";
}

export function resolveShellArgs(shell, platform = process.platform) {
	if (platform === "win32") {
		return [];
	}

	const shellName = shell.split(/[\\/]/).pop() ?? "";
	if (!LOGIN_SHELLS.has(shellName)) {
		return [];
	}

	return ["-l"];
}

export function buildTerminalEnv(
	env = process.env,
	platform = process.platform,
	extraEnv = {},
) {
	const terminalEnv = { ...env, ...normalizeExtraEnv(extraEnv) };
	delete terminalEnv.NO_COLOR;

	if (platform === "win32") {
		return {
			...terminalEnv,
			TERM: "xterm-256color",
		};
	}

	return {
		...terminalEnv,
		PATH: mergePathEntries([
			...(terminalEnv.PATH ?? "").split(":"),
			...(PATH_ENTRIES_BY_PLATFORM[platform] ??
				PATH_ENTRIES_BY_PLATFORM.default),
		]),
		TERM: "xterm-256color",
	};
}

function normalizeExtraEnv(extraEnv) {
	if (!extraEnv || typeof extraEnv !== "object") {
		return {};
	}
	return Object.fromEntries(
		Object.entries(extraEnv)
			.filter(([key, value]) => {
				return (
					typeof key === "string" && key.length > 0 && typeof value === "string"
				);
			})
			.map(([key, value]) => [key, value]),
	);
}

function mergePathEntries(entries) {
	const seen = new Set();
	const merged = [];

	for (const rawEntry of entries) {
		const entry = rawEntry.trim();
		if (!entry || seen.has(entry)) {
			continue;
		}
		seen.add(entry);
		merged.push(entry);
	}

	return merged.join(":");
}
