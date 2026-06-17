import { describe, expect, test, vi } from "vitest";
import {
	APP_BUNDLE_ID,
	getAppBundlePathFromExecutablePath,
	getMarkdownContentTypesToRegister,
	getNonCanonicalFlashtypeBundlePathsFromLsregisterDump,
	isCanonicalInstalledAppBundle,
	LSREGISTER_PATH,
	registerMarkdownDefaultHandler,
	shouldReplaceMarkdownDefaultHandler,
} from "./markdown-default-handler.mjs";

describe("Markdown default handler registration policy", () => {
	test("derives the .app bundle path from a packaged executable path", () => {
		expect(
			getAppBundlePathFromExecutablePath(
				"/Applications/Flashtype.app/Contents/MacOS/Flashtype",
			),
		).toBe("/Applications/Flashtype.app");
	});

	test("only treats the /Applications app bundle as canonical", () => {
		expect(isCanonicalInstalledAppBundle("/Applications/Flashtype.app")).toBe(
			true,
		);
		expect(
			isCanonicalInstalledAppBundle(
				"/Volumes/Flashtype 0.1.1-arm64/Flashtype.app",
			),
		).toBe(false);
		expect(
			isCanonicalInstalledAppBundle(
				"/tmp/flashtype/release/mac-arm64/Flashtype.app",
			),
		).toBe(false);
	});

	test("replaces no handler, Xcode, and Flashtype itself", () => {
		expect(shouldReplaceMarkdownDefaultHandler(null)).toBe(true);
		expect(shouldReplaceMarkdownDefaultHandler("com.apple.dt.Xcode")).toBe(
			true,
		);
		expect(shouldReplaceMarkdownDefaultHandler(APP_BUNDLE_ID)).toBe(true);
	});

	test("preserves third-party Markdown defaults", () => {
		expect(shouldReplaceMarkdownDefaultHandler("com.microsoft.VSCode")).toBe(
			false,
		);
		expect(shouldReplaceMarkdownDefaultHandler("md.obsidian")).toBe(false);
	});

	test("chooses only replaceable Markdown content types", () => {
		expect(
			getMarkdownContentTypesToRegister({
				"public.markdown": "com.apple.dt.Xcode",
				"net.daringfireball.markdown": "com.microsoft.VSCode",
			}),
		).toEqual(["public.markdown"]);
	});

	test("finds registered noncanonical Flashtype app bundles", () => {
		const dump = `
--------------------------------------------------------------------------------
bundle id:                  Flashtype (0x40c8)
path:                       /Applications/Flashtype.app (0x5bcc)
identifier:                 com.flashtype.app
versionString:              0.2.0

--------------------------------------------------------------------------------
bundle id:                  Flashtype (0x3f44)
path:                       /Volumes/Flashtype 0.1.1-arm64/Flashtype.app (0x59dc)
identifier:                 com.flashtype.app
versionString:              0.1.1

--------------------------------------------------------------------------------
bundle id:                  Flashtype Helper (0x5bdc)
path:                       /Applications/Flashtype.app/Contents/Frameworks/Flashtype Helper.app (0x5bdc)
identifier:                 com.flashtype.app.helper
versionString:              0.2.0

--------------------------------------------------------------------------------
bundle id:                  Other (0x1234)
path:                       /Applications/Other.app (0x1234)
identifier:                 com.example.other
versionString:              1.0.0
`;

		expect(getNonCanonicalFlashtypeBundlePathsFromLsregisterDump(dump)).toEqual(
			["/Volumes/Flashtype 0.1.1-arm64/Flashtype.app"],
		);
	});

	test("skips packaged apps outside /Applications", async () => {
		const execFileAsync = vi.fn();

		const result = await registerMarkdownDefaultHandler({
			execFileAsync,
			executablePath:
				"/Volumes/Flashtype 0.1.1-arm64/Flashtype.app/Contents/MacOS/Flashtype",
			isPackaged: true,
			platform: "darwin",
		});

		expect(result).toEqual({
			status: "skipped",
			reason: "non-canonical-app-bundle",
		});
		expect(execFileAsync).not.toHaveBeenCalled();
	});

	test("registers only from the canonical installed app", async () => {
		const execFileAsync = vi
			.fn()
			.mockResolvedValueOnce({
				stdout: `
--------------------------------------------------------------------------------
path:                       /Applications/Flashtype.app (0x5bcc)
identifier:                 com.flashtype.app

--------------------------------------------------------------------------------
path:                       /Volumes/Flashtype 0.1.1-arm64/Flashtype.app (0x59dc)
identifier:                 com.flashtype.app
`,
			})
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					"public.markdown": "com.apple.dt.Xcode",
					"net.daringfireball.markdown": null,
				}),
			})
			.mockResolvedValueOnce({ stdout: "" });

		const result = await registerMarkdownDefaultHandler({
			execFileAsync,
			executablePath: "/Applications/Flashtype.app/Contents/MacOS/Flashtype",
			isPackaged: true,
			platform: "darwin",
		});

		expect(result).toEqual({
			status: "registered",
			contentTypes: ["public.markdown", "net.daringfireball.markdown"],
			unregisteredAppBundlePaths: [
				"/Volumes/Flashtype 0.1.1-arm64/Flashtype.app",
			],
		});
		expect(execFileAsync).toHaveBeenNthCalledWith(
			1,
			LSREGISTER_PATH,
			["-dump"],
			{ timeout: 5000, maxBuffer: 20 * 1024 * 1024 },
		);
		expect(execFileAsync).toHaveBeenNthCalledWith(
			2,
			LSREGISTER_PATH,
			["-u", "/Volumes/Flashtype 0.1.1-arm64/Flashtype.app"],
			{ timeout: 5000 },
		);
		expect(execFileAsync).toHaveBeenNthCalledWith(
			3,
			LSREGISTER_PATH,
			["-f", "/Applications/Flashtype.app"],
			{ timeout: 5000 },
		);
		expect(execFileAsync).toHaveBeenNthCalledWith(
			4,
			"/usr/bin/osascript",
			expect.arrayContaining(["JavaScript"]),
			{ timeout: 5000 },
		);
		expect(execFileAsync).toHaveBeenNthCalledWith(
			5,
			"/usr/bin/osascript",
			expect.arrayContaining(["JavaScript"]),
			{ timeout: 5000 },
		);

		const queryScript = execFileAsync.mock.calls[3][1][3];
		expect(queryScript).toContain("ObjC.castRefToObject(handler)");

		const registrationScript = execFileAsync.mock.calls[4][1][3];
		expect(registrationScript).toContain('"public.markdown"');
		expect(registrationScript).toContain('"net.daringfireball.markdown"');
		expect(registrationScript).toContain(APP_BUNDLE_ID);
	});

	test("registers only filtered content types through the full workflow", async () => {
		const execFileAsync = vi
			.fn()
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					"public.markdown": "com.apple.dt.Xcode",
					"net.daringfireball.markdown": "com.microsoft.VSCode",
				}),
			})
			.mockResolvedValueOnce({ stdout: "" });

		const result = await registerMarkdownDefaultHandler({
			execFileAsync,
			executablePath: "/Applications/Flashtype.app/Contents/MacOS/Flashtype",
			isPackaged: true,
			platform: "darwin",
		});

		expect(result).toEqual({
			status: "registered",
			contentTypes: ["public.markdown"],
			unregisteredAppBundlePaths: [],
		});

		const registrationScript = execFileAsync.mock.calls[3][1][3];
		expect(registrationScript).toContain('"public.markdown"');
		expect(registrationScript).not.toContain('"net.daringfireball.markdown"');
	});

	test("preserves user-selected third-party handlers", async () => {
		const execFileAsync = vi
			.fn()
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					"public.markdown": "com.microsoft.VSCode",
					"net.daringfireball.markdown": "md.obsidian",
				}),
			});

		const result = await registerMarkdownDefaultHandler({
			execFileAsync,
			executablePath: "/Applications/Flashtype.app/Contents/MacOS/Flashtype",
			isPackaged: true,
			platform: "darwin",
		});

		expect(result).toEqual({
			status: "skipped",
			reason: "user-handler-preserved",
		});
		expect(execFileAsync).toHaveBeenCalledTimes(3);
	});
});
