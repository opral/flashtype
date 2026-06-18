import { describe, expect, test } from "vitest";
import { createTerminalOutputNormalizer } from "./ansi-style-normalizer";

const mutedBackground = "\x1b[48;2;68;64;60m";
const mutedForeground = "\x1b[38;2;231;229;228m";

describe("terminal ANSI style normalizer", () => {
	test("mutes basic ANSI diff backgrounds", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(
			normalizer.write(
				"\x1b[41mremoved\x1b[42madded\x1b[101mbright removed\x1b[102mbright added\x1b[0m",
			),
		).toBe(
			`${mutedBackground}removed${mutedBackground}added${mutedBackground}bright removed${mutedBackground}bright added\x1b[0m`,
		);
	});

	test("mutes dark truecolor red and green backgrounds", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(
			normalizer.write(
				"\x1b[48;2;69;10;0mremoved\x1b[48;2;0;46;0madded\x1b[0m",
			),
		).toBe(`${mutedBackground}removed${mutedBackground}added\x1b[0m`);
	});

	test("keeps ordinary foreground color outside muted blocks", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(normalizer.write("\x1b[32mprompt\x1b[0m")).toBe(
			"\x1b[32mprompt\x1b[0m",
		);
	});

	test("mutes diff foreground colors while a muted background is active", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(normalizer.write("\x1b[48;2;0;46;0m\x1b[32m+line\x1b[0m")).toBe(
			`${mutedBackground}${mutedForeground}+line\x1b[0m`,
		);
	});

	test("handles escape sequences split across chunks", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(normalizer.write("before \x1b[48;2;0;46")).toBe("before ");
		expect(normalizer.write(";0madded")).toBe(`${mutedBackground}added`);
	});

	test("keeps unchanged extended colors intact", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(
			normalizer.write(
				"\x1b[38;2;42;42;42mfg\x1b[48;2;42;42;42mbg\x1b[48;5;15mindexed",
			),
		).toBe(
			"\x1b[38;2;42;42;42mfg\x1b[48;2;42;42;42mbg\x1b[48;5;15mindexed",
		);
	});

	test("clears muted state when a normal background replaces it", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(normalizer.write("\x1b[41mremoved\x1b[44mblue\x1b[32mgreen")).toBe(
			`${mutedBackground}removed\x1b[44mblue\x1b[32mgreen`,
		);
		expect(
			normalizer.write("\x1b[41mremoved\x1b[48;2;255;255;255mwhite\x1b[32mgreen"),
		).toBe(`${mutedBackground}removed\x1b[48;2;255;255;255mwhite\x1b[32mgreen`);
	});

	test("mutes 256-color diff backgrounds", () => {
		const normalizer = createTerminalOutputNormalizer();

		expect(
			normalizer.write("\x1b[48;5;2mgreen\x1b[48;5;22mdark green\x1b[48;5;1mred"),
		).toBe(
			`${mutedBackground}green${mutedBackground}dark green${mutedBackground}red`,
		);
	});
});
