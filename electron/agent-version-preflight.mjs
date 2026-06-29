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

export async function checkAgentVersionPreflight(args) {
	const agent = readAgentFromPathWrapper(args?.pathWrapper);
	if (!agent) {
		return null;
	}
	const requirement = AGENT_REQUIREMENTS[agent];
	const probe = await runAgentVersionProbe({
		command: requirement.command,
		cwd: args.cwd,
		env: args.env,
		shell: args.shell,
		shellArgs: args.shellArgs,
		timeoutMs: args.timeoutMs,
	});
	const output = normalizeProbeOutput(probe.output);
	const detectedVersion = parseFirstSemver(output);

	if (probe.timedOut) {
		return agentVersionError({
			agent,
			detectedVersion,
			output,
			reason: "timeout",
			requiredVersion: requirement.requiredVersion,
		});
	}

	if (probe.exitCode !== 0) {
		return agentVersionError({
			agent,
			detectedVersion,
			output,
			reason: isMissingCommandFailure(probe, output) ? "missing" : "failed",
			requiredVersion: requirement.requiredVersion,
		});
	}

	if (!detectedVersion) {
		return agentVersionError({
			agent,
			output,
			reason: "unparseable",
			requiredVersion: requirement.requiredVersion,
		});
	}

	if (compareSemver(detectedVersion, requirement.requiredVersion) < 0) {
		return agentVersionError({
			agent,
			detectedVersion,
			output,
			reason: "unsupported",
			requiredVersion: requirement.requiredVersion,
		});
	}

	return null;
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
		let terminal;
		try {
			terminal = pty.spawn(args.shell, args.shellArgs ?? [], {
				name: "xterm-256color",
				cwd: args.cwd,
				cols: 80,
				rows: 24,
				env: args.env,
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
			resolve({ output, ...result });
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
		terminal.write(`${args.command}\r`);
		terminal.write("exit\r");
	});
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

function isMissingCommandFailure(probe, output) {
	return (
		probe.exitCode === 127 ||
		/(command not found|not found|not recognized|no such file or directory)/iu.test(
			output,
		)
	);
}
