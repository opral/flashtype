import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	choosePreferredAgent,
	classifyClaudeAuthPayload,
	classifyCodexAccountPayload,
	probeInstalledAgentStatus,
} from "./agent-status.mjs";

const unixTest = process.platform === "win32" ? test.skip : test;

describe("agent status classification", () => {
	test("classifies Claude auth status output", () => {
		expect(
			classifyClaudeAuthPayload({
				loggedIn: false,
			}),
		).toBe("notSignedIn");
		expect(
			classifyClaudeAuthPayload({
				apiProvider: "firstParty",
				authMethod: "claude.ai",
				loggedIn: true,
				subscriptionType: null,
			}),
		).toBe("free");
		expect(
			classifyClaudeAuthPayload({
				apiProvider: "firstParty",
				authMethod: "claude.ai",
				loggedIn: true,
				subscriptionType: "pro",
			}),
		).toBe("paid");
		expect(
			classifyClaudeAuthPayload({
				apiProvider: "anthropic",
				authMethod: "apiKey",
				loggedIn: true,
				subscriptionType: null,
			}),
		).toBe("signedIn");
		expect(classifyClaudeAuthPayload(null)).toBe("unknown");
	});

	test("classifies Codex account/read output", () => {
		expect(
			classifyCodexAccountPayload({
				account: null,
				requiresOpenaiAuth: true,
			}),
		).toBe("notSignedIn");
		expect(
			classifyCodexAccountPayload({
				account: { type: "chatgpt", email: null, planType: "free" },
				requiresOpenaiAuth: true,
			}),
		).toBe("free");
		expect(
			classifyCodexAccountPayload({
				account: { type: "chatgpt", email: null, planType: "pro" },
				requiresOpenaiAuth: true,
			}),
		).toBe("paid");
		expect(
			classifyCodexAccountPayload({
				account: { type: "apiKey" },
				requiresOpenaiAuth: false,
			}),
		).toBe("signedIn");
		expect(classifyCodexAccountPayload({})).toBe("unknown");
	});
});

describe("agent preference ranking", () => {
	test("uses requested tier tie-breaks and auto-launch rules", () => {
		expect(
			choosePreferredAgent({
				claude: status({ authStatus: "paid", supportedVersion: true }),
				codex: status({ authStatus: "paid", supportedVersion: true }),
			}),
		).toMatchObject({
			autoLaunchAgent: "claude",
			preferredAgent: "claude",
			reason: "paid",
			versionBlockedAutoLaunchAgent: null,
		});
		expect(
			choosePreferredAgent({
				claude: status({ authStatus: "free", supportedVersion: true }),
				codex: status({ authStatus: "free", supportedVersion: true }),
			}),
		).toMatchObject({
			autoLaunchAgent: "codex",
			preferredAgent: "codex",
			reason: "free",
			versionBlockedAutoLaunchAgent: null,
		});
		expect(
			choosePreferredAgent({
				claude: status({ authStatus: "signedIn" }),
				codex: status({ authStatus: "signedIn" }),
			}),
		).toMatchObject({
			autoLaunchAgent: null,
			preferredAgent: "claude",
			reason: "signedIn",
		});
		expect(
			choosePreferredAgent({
				claude: status({ installed: true, supportedVersion: true }),
				codex: status({ installed: true, supportedVersion: true }),
			}),
		).toMatchObject({
			autoLaunchAgent: null,
			preferredAgent: "claude",
			reason: "supportedVersion",
		});
		expect(
			choosePreferredAgent({
				claude: status(),
				codex: status({ installed: true }),
			}),
		).toMatchObject({
			autoLaunchAgent: null,
			preferredAgent: "codex",
			reason: "installed",
		});
	});

	test("blocks paid and free auto-launches when the selected agent version is unsupported", () => {
		expect(
			choosePreferredAgent({
				claude: status({ authStatus: "paid", supportedVersion: false }),
				codex: status({ authStatus: "paid", supportedVersion: true }),
			}),
		).toMatchObject({
			autoLaunchAgent: null,
			preferredAgent: "claude",
			reason: "paid",
			versionBlockedAutoLaunchAgent: "claude",
		});
		expect(
			choosePreferredAgent({
				claude: status({ authStatus: "free", supportedVersion: true }),
				codex: status({ authStatus: "free", supportedVersion: false }),
			}),
		).toMatchObject({
			autoLaunchAgent: null,
			preferredAgent: "codex",
			reason: "free",
			versionBlockedAutoLaunchAgent: "codex",
		});
		expect(
			choosePreferredAgent({
				claude: status({ authStatus: "paid", supportedVersion: false }),
				codex: status({ authStatus: "free", supportedVersion: true }),
			}),
		).toMatchObject({
			autoLaunchAgent: null,
			preferredAgent: "claude",
			reason: "paid",
			versionBlockedAutoLaunchAgent: "claude",
		});
	});
});

describe("agent preference probe", () => {
	unixTest(
		"reads fake Claude and Codex auth through the user shell",
		async () => {
			const rootDir = await mkdtemp(
				path.join(tmpdir(), "flashtype-agent-status-test-"),
			);
			try {
				const binDir = path.join(rootDir, "bin");
				await mkdir(binDir);
				await writeExecutable(
					path.join(binDir, "claude"),
					`
if [ "$1" = "--version" ]; then
  printf "%s\\n" "2.1.78 (Claude Code)"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf "\\0337\\033[r\\0338%s\\033(B\\017\\n" '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"pro"}'
  exit 0
fi
exit 1
`,
				);
				await writeExecutable(
					path.join(binDir, "codex"),
					`
if [ "$1" = "--version" ]; then
  printf "%s\\n" "codex-cli 0.134.0"
  exit 0
fi
if [ "$1" = "app-server" ] && [ "$2" = "--stdio" ]; then
  while IFS= read -r line; do
    case "$line" in
      *\\"id\\":1*) printf "\\033]0;codex\\007%s\\033(B\\017\\n" '{"id":1,"result":{}}' ;;
      *\\"method\\":\\"account/read\\"*) printf "\\0337\\033[3G%s\\0338\\017\\n" '{"id":2,"result":{"account":{"type":"chatgpt","email":null,"planType":"free"},"requiresOpenaiAuth":true}}'; exit 0 ;;
    esac
  done
fi
exit 1
`,
				);

				const preference = await probePreferredInstalledAgents(
					probeArgs({ PATH: testPath(binDir) }),
				);

				expect(preference).toMatchObject({
					autoLaunchAgent: "claude",
					preferredAgent: "claude",
					reason: "paid",
					agents: {
						claude: {
							authStatus: "paid",
							installed: true,
							supportedVersion: true,
						},
						codex: {
							authStatus: "free",
							installed: true,
							supportedVersion: true,
						},
					},
				});
			} finally {
				await rm(rootDir, { recursive: true, force: true });
			}
		},
	);

	unixTest(
		"falls back to supported installed versions when auth times out",
		async () => {
			const rootDir = await mkdtemp(
				path.join(tmpdir(), "flashtype-agent-status-test-"),
			);
			try {
				const binDir = path.join(rootDir, "bin");
				await mkdir(binDir);
				await writeExecutable(
					path.join(binDir, "claude"),
					`
if [ "$1" = "--version" ]; then
  printf "%s\\n" "2.1.78 (Claude Code)"
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  sleep 10
fi
`,
				);
				await writeExecutable(
					path.join(binDir, "codex"),
					`
if [ "$1" = "--version" ]; then
  printf "%s\\n" "codex-cli 0.134.0"
  exit 0
fi
if [ "$1" = "app-server" ] && [ "$2" = "--stdio" ]; then
  while true; do sleep 1; done
fi
`,
				);

				const preference = await probePreferredInstalledAgents(
					probeArgs({ PATH: testPath(binDir), timeoutMs: 100 }),
				);

				expect(preference).toMatchObject({
					autoLaunchAgent: null,
					preferredAgent: "claude",
					reason: "supportedVersion",
					agents: {
						claude: { authStatus: "unknown", supportedVersion: true },
						codex: { authStatus: "unknown", supportedVersion: true },
					},
				});
			} finally {
				await rm(rootDir, { recursive: true, force: true });
			}
		},
	);

	unixTest(
		"falls back to installed agents when auth and version checks fail",
		async () => {
			const rootDir = await mkdtemp(
				path.join(tmpdir(), "flashtype-agent-status-test-"),
			);
			try {
				const binDir = path.join(rootDir, "bin");
				await mkdir(binDir);
				await writeExecutable(
					path.join(binDir, "claude"),
					`
if [ "$1" = "--version" ]; then
  printf "%s\\n" "version unavailable"
  exit 2
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf "%s\\n" "auth unavailable"
  exit 2
fi
exit 1
`,
				);

				const preference = choosePreferredAgent({
					claude: await probeInstalledAgentStatus(
						"claude",
						probeArgs({ PATH: testPath(binDir) }),
					),
					codex: status(),
				});

				expect(preference).toMatchObject({
					autoLaunchAgent: null,
					preferredAgent: "claude",
					reason: "installed",
					agents: {
						claude: {
							authStatus: "unknown",
							installed: true,
							supportedVersion: false,
						},
						codex: {
							installed: false,
							supportedVersion: false,
						},
					},
				});
			} finally {
				await rm(rootDir, { recursive: true, force: true });
			}
		},
	);
});

function status(overrides = {}) {
	return {
		authStatus: "unknown",
		installed: false,
		supportedVersion: false,
		...overrides,
	};
}

async function probePreferredInstalledAgents(args) {
	const [claude, codex] = await Promise.all([
		probeInstalledAgentStatus("claude", args),
		probeInstalledAgentStatus("codex", args),
	]);
	return choosePreferredAgent({ claude, codex });
}

function probeArgs(options = {}) {
	return {
		cwd: process.cwd(),
		env: {
			...process.env,
			PATH: options.PATH ?? process.env.PATH,
			TERM: "xterm-256color",
		},
		shell: "/bin/sh",
		shellArgs: [],
		timeoutMs: options.timeoutMs,
	};
}

function testPath(binDir) {
	return [binDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
}

async function writeExecutable(filePath, body) {
	await writeFile(filePath, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
	await chmod(filePath, 0o700);
}
