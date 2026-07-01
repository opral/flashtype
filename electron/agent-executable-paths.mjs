import { randomUUID } from "node:crypto";
import path from "node:path";
import pty from "node-pty";

const AGENT_EXECUTABLE_NAMES = ["claude", "codex"];
const AGENT_PATH_RESOLUTION_TIMEOUT_MS = 8_000;
const MAX_PROBE_OUTPUT_LENGTH = 16 * 1024;

let cachedAgentExecutablePaths = emptyAgentExecutablePaths();

export function getCachedAgentExecutablePaths() {
	return { ...cachedAgentExecutablePaths };
}

export async function refreshAgentExecutablePaths(args) {
	const probe = await runAgentExecutablePathProbe(args);
	if (!probe.markerComplete || probe.timedOut) {
		return getCachedAgentExecutablePaths();
	}
	const paths = { ...probe.paths };
	cachedAgentExecutablePaths = paths;
	return { ...paths };
}

export function resetAgentExecutablePathsForTests() {
	cachedAgentExecutablePaths = emptyAgentExecutablePaths();
}

export function runAgentExecutablePathProbe(args) {
	return new Promise((resolve, reject) => {
		const markers = createProbeMarkers();
		let terminal;
		try {
			terminal = pty.spawn(args.shell, args.shellArgs ?? [], {
				name: "xterm-256color",
				cwd: args.cwd,
				cols: 80,
				rows: 24,
				env: {
					...args.env,
					FLASHTYPE_AGENT_PATH_RESOLVE_END: markers.end,
					FLASHTYPE_AGENT_PATH_RESOLVE_START: markers.start,
				},
			});
		} catch (error) {
			reject(error);
			return;
		}

		let output = "";
		let settled = false;
		const finish = (result) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			const extracted = extractProbeResult(output, markers);
			resolve({
				...result,
				markerComplete: extracted.markerComplete,
				output: extracted.output,
				paths: extracted.paths,
			});
		};
		const timeout = setTimeout(() => {
			try {
				terminal.kill();
			} catch {
				// The process may have exited between the timeout and kill attempt.
			}
			finish({ exitCode: null, signal: null, timedOut: true });
		}, args.timeoutMs ?? AGENT_PATH_RESOLUTION_TIMEOUT_MS);

		terminal.onData((data) => {
			output = appendBoundedOutput(output, data);
		});
		terminal.onExit(({ exitCode, signal }) => {
			setTimeout(() => {
				finish({
					exitCode: exitCode ?? null,
					signal: signal ?? null,
					timedOut: false,
				});
			}, 0);
		});
		terminal.write(`${buildProbeCommandLine()}\r`);
		terminal.write("exit\r");
	});
}

function createProbeMarkers() {
	const token = randomUUID().replace(/-/gu, "");
	return {
		start: `__FLASHTYPE_AGENT_PATH_RESOLVE_START_${token}__`,
		end: `__FLASHTYPE_AGENT_PATH_RESOLVE_END_${token}__`,
	};
}

function buildProbeCommandLine() {
	const script = [
		'printf "%s\\n" "$FLASHTYPE_AGENT_PATH_RESOLVE_START"',
		"__flashtype_resolve_agent_path() {",
		'  __flashtype_agent_name="$1"',
		'  __flashtype_old_ifs="$IFS"',
		"  IFS=:",
		"  for __flashtype_path_dir in $PATH; do",
		'    [ -n "$__flashtype_path_dir" ] || __flashtype_path_dir=.',
		'    __flashtype_candidate="$__flashtype_path_dir/$__flashtype_agent_name"',
		'    if [ -f "$__flashtype_candidate" ] && [ -x "$__flashtype_candidate" ]; then',
		'      __flashtype_candidate_dir="${__flashtype_candidate%/*}"',
		'      __flashtype_candidate_base="${__flashtype_candidate##*/}"',
		'      (cd "$__flashtype_candidate_dir" 2>/dev/null && printf "%s/%s\\n" "$(pwd -P)" "$__flashtype_candidate_base")',
		'      IFS="$__flashtype_old_ifs"',
		"      return 0",
		"    fi",
		"  done",
		'  IFS="$__flashtype_old_ifs"',
		"  return 1",
		"}",
		"for __flashtype_agent_name in claude codex; do",
		'  __flashtype_resolved_path="$(__flashtype_resolve_agent_path "$__flashtype_agent_name" 2>/dev/null || true)"',
		'  printf "%s\\t%s\\n" "$__flashtype_agent_name" "$__flashtype_resolved_path"',
		"done",
		'printf "%s\\n" "$FLASHTYPE_AGENT_PATH_RESOLVE_END"',
		"exit 0",
	].join("\n");
	return `/bin/sh -c ${shellQuote(script)}`;
}

function extractProbeResult(output, markers) {
	const normalized = normalizeProbeOutput(output);
	const pattern = new RegExp(
		`${escapeRegExp(markers.start)}([\\s\\S]*?)${escapeRegExp(markers.end)}`,
		"gu",
	);
	let match = null;
	for (const candidate of normalized.matchAll(pattern)) {
		match = candidate;
	}
	if (!match) {
		return {
			markerComplete: false,
			output: normalized,
			paths: emptyAgentExecutablePaths(),
		};
	}
	const extractedOutput = match[1].trim();
	return {
		markerComplete: true,
		output: extractedOutput,
		paths: parseAgentExecutablePathOutput(extractedOutput),
	};
}

function parseAgentExecutablePathOutput(output) {
	const paths = emptyAgentExecutablePaths();
	for (const line of String(output ?? "").split("\n")) {
		const separatorIndex = line.indexOf("\t");
		if (separatorIndex === -1) {
			continue;
		}
		const agent = line.slice(0, separatorIndex);
		const executablePath = line.slice(separatorIndex + 1).trim();
		if (
			!AGENT_EXECUTABLE_NAMES.includes(agent) ||
			!isDirectExecutablePath(executablePath)
		) {
			continue;
		}
		paths[agent] = executablePath;
	}
	return paths;
}

function emptyAgentExecutablePaths() {
	return {
		claude: null,
		codex: null,
	};
}

function isDirectExecutablePath(value) {
	return (
		typeof value === "string" &&
		path.isAbsolute(value) &&
		!value.includes("\0") &&
		!value.includes("\n")
	);
}

function normalizeProbeOutput(output) {
	return String(output ?? "")
		.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
		.replace(/\r/g, "")
		.trim();
}

function appendBoundedOutput(current, next) {
	const output = current + next;
	if (output.length <= MAX_PROBE_OUTPUT_LENGTH) {
		return output;
	}
	return output.slice(output.length - MAX_PROBE_OUTPUT_LENGTH);
}

function shellQuote(value) {
	return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
