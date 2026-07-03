import { randomUUID } from "node:crypto";
import pty from "node-pty";

const AGENT_REQUIREMENTS = {
	claude: {
		command: "claude --version",
		requiredVersion: "2.1.78",
	},
	codex: {
		command: "codex --version",
		requiredVersion: "0.134.0",
	},
};

const AGENT_VERSION_TIMEOUT_MS = 8_000;
const MAX_PROBE_OUTPUT_LENGTH = 16 * 1024;
const ANSI_ESCAPE_PATTERN = new RegExp(
	`${escapeRegExp(String.fromCharCode(27))}\\[[0-?]*[ -/]*[@-~]`,
	"gu",
);

export async function checkAgentVersionPreflight(args) {
	const agent = readAgentFromPathWrapper(args?.pathWrapper);
	if (!agent) {
		return null;
	}
	const support = await checkAgentVersionSupport({
		agent,
		cwd: args.cwd,
		env: args.env,
		shell: args.shell,
		shellArgs: args.shellArgs,
		timeoutMs: args.timeoutMs,
	});
	if (support.supportedVersion) {
		return null;
	}
	return agentVersionError({
		agent,
		detectedVersion: support.detectedVersion,
		output: support.output,
		reason: support.reason,
		requiredVersion: support.requiredVersion,
	});
}

export async function checkAgentVersionSupport(args) {
	const agent = args?.agent;
	const requirement = AGENT_REQUIREMENTS[agent];
	if (!requirement) {
		return {
			agent,
			supportedVersion: false,
			reason: "missing",
			requiredVersion: undefined,
		};
	}
	const probe = await runAgentVersionProbe({
		command: requirement.command,
		cwd: args.cwd,
		env: args.env,
		shell: args.shell,
		shellArgs: args.shellArgs,
		timeoutMs: args.timeoutMs,
	});
	const output = normalizeProbeOutput(probe.output);
	const detectedVersion = probe.markerComplete
		? parseFirstSemver(output)
		: null;

	if (probe.timedOut) {
		return agentVersionSupportError({
			agent,
			detectedVersion,
			output,
			reason: "timeout",
			requiredVersion: requirement.requiredVersion,
		});
	}

	if (probe.exitCode !== 0) {
		return agentVersionSupportError({
			agent,
			detectedVersion,
			output,
			reason:
				probe.markerComplete && isMissingCommandFailure(probe, output)
					? "missing"
					: "failed",
			requiredVersion: requirement.requiredVersion,
		});
	}

	if (!detectedVersion) {
		return agentVersionSupportError({
			agent,
			output,
			reason: "unparseable",
			requiredVersion: requirement.requiredVersion,
		});
	}

	if (compareSemver(detectedVersion, requirement.requiredVersion) < 0) {
		return agentVersionSupportError({
			agent,
			detectedVersion,
			output,
			reason: "unsupported",
			requiredVersion: requirement.requiredVersion,
		});
	}

	return {
		agent,
		detectedVersion,
		requiredVersion: requirement.requiredVersion,
		supportedVersion: true,
	};
}

export function readAgentFromPathWrapper(pathWrapper) {
	const executableName =
		pathWrapper && typeof pathWrapper === "object"
			? pathWrapper.executableName
			: null;
	if (executableName === "claude-flashtype") {
		return "claude";
	}
	if (executableName === "codex-flashtype") {
		return "codex";
	}
	return null;
}

export function parseFirstSemver(output) {
	if (typeof output !== "string") {
		return null;
	}
	const match = output.match(
		/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?/u,
	);
	if (!match) {
		return null;
	}
	return `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}`;
}

export function compareSemver(left, right) {
	const parsedLeft = parseSemver(left);
	const parsedRight = parseSemver(right);
	if (!parsedLeft || !parsedRight) {
		throw new Error(
			`Cannot compare invalid semantic versions: ${left}, ${right}`,
		);
	}
	for (const key of ["major", "minor", "patch"]) {
		if (parsedLeft[key] !== parsedRight[key]) {
			return parsedLeft[key] < parsedRight[key] ? -1 : 1;
		}
	}
	return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function runAgentVersionProbe(args) {
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
					FLASHTYPE_AGENT_VERSION_PROBE_END: markers.end,
					FLASHTYPE_AGENT_VERSION_PROBE_START: markers.start,
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
				exitCode: extracted.exitCode ?? result.exitCode,
				markerComplete: extracted.markerComplete,
				output: extracted.output,
			});
		};
		const timeout = setTimeout(() => {
			try {
				terminal.kill();
			} catch {
				// The process may have exited between the timeout and kill attempt.
			}
			finish({ exitCode: null, signal: null, timedOut: true });
		}, args.timeoutMs ?? AGENT_VERSION_TIMEOUT_MS);

		terminal.onData((data) => {
			output = appendBoundedOutput(output, data);
		});
		terminal.onExit(({ exitCode, signal }) => {
			finish({
				exitCode: exitCode ?? null,
				signal: signal ?? null,
				timedOut: false,
			});
		});
		terminal.write(`${buildProbeCommandLine(args.command)}\r`);
		terminal.write("exit\r");
	});
}

function createProbeMarkers() {
	const token = randomUUID().replace(/-/gu, "");
	return {
		start: `__FLASHTYPE_AGENT_VERSION_PROBE_START_${token}__`,
		end: `__FLASHTYPE_AGENT_VERSION_PROBE_END_${token}__`,
	};
}

function buildProbeCommandLine(command) {
	const script = [
		'printf "%s\\n" "$FLASHTYPE_AGENT_VERSION_PROBE_START"',
		command,
		"__flashtype_agent_version_status=$?",
		'printf "%s %s\\n" "$FLASHTYPE_AGENT_VERSION_PROBE_END" "$__flashtype_agent_version_status"',
		'exit "$__flashtype_agent_version_status"',
	].join("; ");
	return `/bin/sh -c ${shellQuote(script)}`;
}

function extractProbeResult(output, markers) {
	const normalized = normalizeProbeOutput(output);
	const pattern = new RegExp(
		`${escapeRegExp(markers.start)}([\\s\\S]*?)${escapeRegExp(
			markers.end,
		)}[^\\S\\n]*(\\d+)`,
		"gu",
	);
	let match = null;
	for (const candidate of normalized.matchAll(pattern)) {
		match = candidate;
	}
	if (!match) {
		return {
			exitCode: null,
			markerComplete: false,
			output: normalized,
		};
	}
	return {
		exitCode: Number(match[2]),
		markerComplete: true,
		output: match[1].trim(),
	};
}

function agentVersionError(args) {
	return Object.fromEntries(
		Object.entries({
			status: "agentVersionError",
			agent: args.agent,
			requiredVersion: args.requiredVersion,
			detectedVersion: args.detectedVersion,
			reason: args.reason,
			output: args.output || undefined,
		}).filter(([, value]) => value !== undefined),
	);
}

function agentVersionSupportError(args) {
	return Object.fromEntries(
		Object.entries({
			agent: args.agent,
			requiredVersion: args.requiredVersion,
			detectedVersion: args.detectedVersion,
			reason: args.reason,
			output: args.output || undefined,
			supportedVersion: false,
		}).filter(([, value]) => value !== undefined),
	);
}

function parseSemver(value) {
	const match = String(value).match(
		/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u,
	);
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ?? null,
	};
}

function comparePrerelease(left, right) {
	if (left === right) {
		return 0;
	}
	if (!left) {
		return 1;
	}
	if (!right) {
		return -1;
	}
	const leftParts = left.split(".");
	const rightParts = right.split(".");
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = leftParts[index];
		const rightPart = rightParts[index];
		if (leftPart === rightPart) {
			continue;
		}
		if (leftPart === undefined) {
			return -1;
		}
		if (rightPart === undefined) {
			return 1;
		}
		const leftNumeric = /^\d+$/u.test(leftPart);
		const rightNumeric = /^\d+$/u.test(rightPart);
		if (leftNumeric && rightNumeric) {
			const leftNumber = Number(leftPart);
			const rightNumber = Number(rightPart);
			if (leftNumber !== rightNumber) {
				return leftNumber < rightNumber ? -1 : 1;
			}
			continue;
		}
		if (leftNumeric !== rightNumeric) {
			return leftNumeric ? -1 : 1;
		}
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
}

function normalizeProbeOutput(output) {
	return String(output ?? "")
		.replace(ANSI_ESCAPE_PATTERN, "")
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

function isMissingCommandFailure(probe, output) {
	return (
		probe.exitCode === 127 ||
		/(command not found|not found|not recognized|no such file or directory)/iu.test(
			output,
		)
	);
}

function shellQuote(value) {
	return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
