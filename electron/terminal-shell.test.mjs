import { describe, expect, test } from "vitest";
import {
	buildTerminalEnv,
	resolveShell,
	resolveShellArgs,
} from "./terminal-shell.mjs";

describe("terminal shell launch", () => {
	test("uses the user's shell on macOS", () => {
		expect(resolveShell(undefined, { SHELL: "/bin/zsh" }, "darwin")).toBe(
			"/bin/zsh",
		);
	});

	test("starts common Unix shells as login shells", () => {
		expect(resolveShellArgs("/bin/zsh", "darwin")).toEqual(["-l"]);
		expect(resolveShellArgs("/opt/homebrew/bin/fish", "darwin")).toEqual([
			"-l",
		]);
		expect(resolveShellArgs("/bin/zsh", "win32")).toEqual([]);
	});

	test("adds Homebrew paths to a minimal macOS app PATH", () => {
		const env = buildTerminalEnv(
			{ PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
			"darwin",
		);

		expect(env.PATH.split(":")).toEqual([
			"/usr/bin",
			"/bin",
			"/usr/sbin",
			"/sbin",
			"/opt/homebrew/bin",
			"/opt/homebrew/sbin",
			"/usr/local/bin",
			"/usr/local/sbin",
		]);
		expect(env.TERM).toBe("xterm-256color");
	});

	test("does not pass NO_COLOR into spawned terminals", () => {
		const env = buildTerminalEnv(
			{
				PATH: "/usr/bin",
				NO_COLOR: "1",
				COLORTERM: "truecolor",
			},
			"darwin",
		);

		expect(env.NO_COLOR).toBeUndefined();
		expect(env.COLORTERM).toBe("truecolor");
		expect(env.TERM).toBe("xterm-256color");
	});

	test("deduplicates fallback PATH entries", () => {
		const env = buildTerminalEnv(
			{ PATH: "/usr/local/bin:/custom/bin:/usr/local/bin" },
			"linux",
		);

		expect(env.PATH).toBe(
			"/usr/local/bin:/custom/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin",
		);
	});
});
