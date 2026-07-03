import { randomUUID } from "node:crypto";
import pty from "node-pty";
import { runAgentExecutablePathProbe } from "./agent-executable-paths.mjs";
import { checkAgentVersionSupport } from "./agent-version-preflight.mjs";
import {
	buildTerminalEnv,
	resolveShell,
	resolveShellArgs,
} from "./terminal-shell.mjs";

const AGENTS = ["claude", "codex"];
const CODEX_PAID_PLAN_TYPES = new Set([
	"go",
	"plus",
	"pro",
	"prolite",
	"team",
	"self_serve_business_usage_based",
	"business",
	"enterprise_cbp_usage_based",
	"enterprise",
	"edu",
]);
const AGENT_STATUS_TIMEOUT_MS = 8_000;
const MAX_PROBE_OUTPUT_LENGTH = 16 * 1024;
const ANSI_ESCAPE_PATTERN = new RegExp(
	`${escapeRegExp(String.fromCharCode(27))}\\[[0-?]*[ -/]*[@-~]`,
	"gu",
);

export async function getPreferredAgent(args = {}) {
	const probeArgs = normalizeProbeArgs(args);
	const paths = await readAgentExecutablePaths(probeArgs);
	const [claude, codex] = await Promise.all(
		AGENTS.map((agent) =>
			readAgentStatus({
				agent,
				installed: Boolean(paths[agent]),
				probeArgs,
			}),
		),
	);
	return choosePreferredAgent({
		claude,
		codex,
	});
}

async function readAgentExecutablePaths(args) {
	const probe = await runAgentExecutablePathProbe(args).catch(() => null);
	if (!probe || probe.timedOut || !probe.markerComplete) {
		return {
			claude: null,
			codex: null,
		};
	}
	return {
		claude: probe.paths?.claude ?? null,
		codex: probe.paths?.codex ?? null,
	};
}

function normalizeProbeArgs(args) {
	const shell = resolveShell(args?.shell);
	return {
		...args,
		env: args?.env ?? buildTerminalEnv(process.env, process.platform, {}),
		shell,
		shellArgs: args?.shellArgs ?? resolveShellArgs(shell),
	};
}

export function choosePreferredAgent(agents) {
	const tiers = [
		{
			reason: "paid",
			autoLaunch: true,
			preferredTie: "claude",
			matches: (status) => status.authStatus === "paid",
		},
		{
			reason: "free",
			autoLaunch: true,
			preferredTie: "codex",
			matches: (status) => status.authStatus === "free",
		},
		{
			reason: "signedIn",
			autoLaunch: false,
			preferredTie: "claude",
			matches: (status) => status.authStatus === "signedIn",
		},
		{
			reason: "supportedVersion",
			autoLaunch: false,
			preferredTie: "claude",
			matches: (status) => status.installed && status.supportedVersion,
		},
		{
			reason: "installed",
			autoLaunch: false,
			preferredTie: "claude",
			matches: (status) => status.installed,
		},
	];

	for (const tier of tiers) {
		const candidates = AGENTS.filter((agent) => tier.matches(agents[agent]));
		if (candidates.length === 0) {
			continue;
		}
		const preferredAgent = candidates.includes(tier.preferredTie)
			? tier.preferredTie
			: candidates[0];
		const supportsAutoLaunch =
			tier.autoLaunch && agents[preferredAgent]?.supportedVersion === true;
		return {
			agents,
			autoLaunchAgent: supportsAutoLaunch ? preferredAgent : null,
			preferredAgent,
			reason: tier.reason,
			versionBlockedAutoLaunchAgent:
				tier.autoLaunch && !supportsAutoLaunch ? preferredAgent : null,
		};
	}

	return {
		agents,
		autoLaunchAgent: null,
		preferredAgent: "claude",
		reason: "fallback",
		versionBlockedAutoLaunchAgent: null,
	};
}

export function classifyClaudeAuthPayload(payload) {
	if (!payload || typeof payload !== "object") {
		return "unknown";
	}
	if (payload.loggedIn !== true) {
		return "notSignedIn";
	}
	if (
		payload.authMethod === "claude.ai" &&
		payload.apiProvider === "firstParty" &&
		payload.subscriptionType === null
	) {
		return "free";
	}
	if (payload.subscriptionType != null) {
		return "paid";
	}
	return "signedIn";
}

export function classifyCodexAccountPayload(payload) {
	if (!payload || typeof payload !== "object") {
		return "unknown";
	}
	if (!Object.hasOwn(payload, "account")) {
		return "unknown";
	}
	const account = payload.account;
	if (account === null) {
		return "notSignedIn";
	}
	if (!account || typeof account !== "object") {
		return "unknown";
	}
	if (account.type !== "chatgpt") {
		return "signedIn";
	}
	if (account.planType === "free") {
		return "free";
	}
	if (CODEX_PAID_PLAN_TYPES.has(account.planType)) {
		return "paid";
	}
	return "signedIn";
}

async function readAgentStatus({ agent, installed, probeArgs }) {
	if (!installed) {
		return {
			authStatus: "unknown",
			installed: false,
			supportedVersion: false,
		};
	}

	const [authStatus, versionSupport] = await Promise.all([
		readAgentAuthStatus(agent, probeArgs),
		checkAgentVersionSupport({
			...probeArgs,
			agent,
		}).catch(() => ({ supportedVersion: false })),
	]);

	return Object.fromEntries(
		Object.entries({
			authStatus,
			installed: true,
			supportedVersion: versionSupport.supportedVersion === true,
			detectedVersion: versionSupport.detectedVersion,
		}).filter(([, value]) => value !== undefined),
	);
}

export async function probeInstalledAgentStatus(agent, args = {}) {
	return await readAgentStatus({
		agent,
		installed: true,
		probeArgs: normalizeProbeArgs(args),
	});
}

async function readAgentAuthStatus(agent, args) {
	if (agent === "claude") {
		return await readClaudeAuthStatus(args);
	}
	if (agent === "codex") {
		return await readCodexAuthStatus(args);
	}
	return "unknown";
}

async function readClaudeAuthStatus(args) {
	const probe = await runMarkedCommandProbe({
		...args,
		command: "claude auth status",
	});
	if (
		probe.timedOut ||
		probe.exitCode !== 0 ||
		!probe.markerComplete ||
		!probe.output
	) {
		return "unknown";
	}
	try {
		return classifyClaudeAuthPayload(JSON.parse(probe.output));
	} catch {
		return "unknown";
	}
}

async function readCodexAuthStatus(args) {
	const probe = await runCodexAccountReadProbe(args);
	if (probe.timedOut || !probe.response?.result) {
		return "unknown";
	}
	return classifyCodexAccountPayload(probe.response.result);
}

function runMarkedCommandProbe(args) {
	return new Promise((resolve, reject) => {
		const markers = createProbeMarkers("AUTH");
		let terminal;
		try {
			terminal = pty.spawn(args.shell, args.shellArgs ?? [], {
				name: "xterm-256color",
				cwd: args.cwd,
				cols: 120,
				rows: 24,
				env: {
					...args.env,
					FLASHTYPE_AGENT_STATUS_PROBE_END: markers.end,
					FLASHTYPE_AGENT_STATUS_PROBE_START: markers.start,
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
			const extracted = extractMarkedProbeResult(output, markers);
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
		}, args.timeoutMs ?? AGENT_STATUS_TIMEOUT_MS);

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
		terminal.write(`${buildMarkedCommandLine(args.command)}\r`);
		terminal.write("exit\r");
	});
}

function runCodexAccountReadProbe(args = {}) {
	return new Promise((resolve, reject) => {
		const markers = createProbeMarkers("CODEX_ACCOUNT");
		let terminal;
		try {
			terminal = pty.spawn(args.shell, args.shellArgs ?? [], {
				name: "xterm-256color",
				cwd: args.cwd,
				cols: 240,
				rows: 24,
				env: {
					...args.env,
					FLASHTYPE_CODEX_ACCOUNT_PROBE_START: markers.start,
				},
			});
		} catch (error) {
			reject(error);
			return;
		}

		let output = "";
		let requestSent = false;
		let requestTimer = null;
		let settled = false;
		const finish = (result) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			if (requestTimer !== null) {
				clearTimeout(requestTimer);
			}
			try {
				terminal.kill();
			} catch {
				// The process may already be gone.
			}
			resolve({
				...result,
				output: normalizeProbeOutput(output),
				response: findCodexAccountResponse(output),
			});
		};
		const sendRequests = () => {
			if (requestSent || settled) {
				return;
			}
			requestSent = true;
			for (const message of buildCodexAccountReadMessages()) {
				terminal.write(`${JSON.stringify(message)}\n`);
			}
		};
		const scheduleRequests = () => {
			if (requestSent || requestTimer !== null) {
				return;
			}
			requestTimer = setTimeout(sendRequests, 100);
		};
		const timeout = setTimeout(() => {
			finish({ exitCode: null, signal: null, timedOut: true });
		}, args.timeoutMs ?? AGENT_STATUS_TIMEOUT_MS);

		terminal.onData((data) => {
			output = appendBoundedOutput(output, data);
			const normalized = normalizeProbeOutput(output);
			if (normalized.includes(markers.start)) {
				scheduleRequests();
			}
			const response = findCodexAccountResponse(output);
			if (response) {
				finish({ exitCode: null, signal: null, timedOut: false });
			}
		});
		terminal.onExit(({ exitCode, signal }) => {
			finish({
				exitCode: exitCode ?? null,
				signal: signal ?? null,
				timedOut: false,
			});
		});
		terminal.write(`${buildCodexAccountCommandLine()}\r`);
	});
}

function buildCodexAccountReadMessages() {
	return [
		{
			id: 1,
			method: "initialize",
			params: {
				capabilities: {
					experimentalApi: true,
					optOutNotificationMethods: [],
					requestAttestation: false,
				},
				clientInfo: {
					name: "flashtype-agent-status",
					title: "Flashtype Agent Status",
					version: "0.0.0",
				},
			},
		},
		{ method: "initialized" },
		{
			id: 2,
			method: "account/read",
			params: { refreshToken: false },
		},
	];
}

function buildMarkedCommandLine(command) {
	const script = [
		'printf "%s\\n" "$FLASHTYPE_AGENT_STATUS_PROBE_START"',
		command,
		"__flashtype_agent_status=$?",
		'printf "%s %s\\n" "$FLASHTYPE_AGENT_STATUS_PROBE_END" "$__flashtype_agent_status"',
		'exit "$__flashtype_agent_status"',
	].join("; ");
	return `/bin/sh -c ${shellQuote(script)}`;
}

function buildCodexAccountCommandLine() {
	const script = [
		'printf "%s\\n" "$FLASHTYPE_CODEX_ACCOUNT_PROBE_START"',
		"codex app-server --stdio",
	].join("; ");
	return `/bin/sh -c ${shellQuote(script)}`;
}

function extractMarkedProbeResult(output, markers) {
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

function findCodexAccountResponse(output) {
	for (const message of parseJsonLines(normalizeProbeOutput(output))) {
		if (
			message &&
			typeof message === "object" &&
			message.id === 2 &&
			("result" in message || "error" in message)
		) {
			return message;
		}
	}
	return null;
}

function parseJsonLines(output) {
	const messages = [];
	for (const line of String(output ?? "").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
			continue;
		}
		try {
			messages.push(JSON.parse(trimmed));
		} catch {
			// Ignore shell echoes, wrapped lines, and structured logs.
		}
	}
	return messages;
}

function createProbeMarkers(prefix) {
	const token = randomUUID().replace(/-/gu, "");
	return {
		start: `__FLASHTYPE_${prefix}_PROBE_START_${token}__`,
		end: `__FLASHTYPE_${prefix}_PROBE_END_${token}__`,
	};
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

function shellQuote(value) {
	return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
