import { describe, expect, test, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
	APP_BUNDLE_ID,
	getAppBundlePathFromExecutablePath,
	getDocumentContentTypesToRegister,
	getNonCanonicalFlashtypeBundlePathsFromLsregisterDump,
	isCanonicalInstalledAppBundle,
	LSREGISTER_PATH,
	registerDocumentDefaultHandlers,
	shouldReplaceDocumentDefaultHandler,
} from "./document-default-handlers.mjs";

describe("Document default handler registration policy", () => {
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

	test("claims only unassigned types or Flashtype itself", () => {
		expect(shouldReplaceDocumentDefaultHandler(null)).toBe(true);
		expect(shouldReplaceDocumentDefaultHandler("com.apple.dt.Xcode")).toBe(
			false,
		);
		expect(shouldReplaceDocumentDefaultHandler("com.apple.TextEdit")).toBe(
			false,
		);
		expect(shouldReplaceDocumentDefaultHandler(APP_BUNDLE_ID)).toBe(true);
	});

	test("preserves third-party Markdown defaults", () => {
		expect(shouldReplaceDocumentDefaultHandler("com.microsoft.VSCode")).toBe(
			false,
		);
		expect(shouldReplaceDocumentDefaultHandler("md.obsidian")).toBe(false);
	});

	test("chooses only replaceable Markdown content types", () => {
		expect(
			getDocumentContentTypesToRegister({
				"public.markdown": null,
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
path:                       /Volumes/Flashtype 0.1.1-arm64/Flashtype.app (0x59DC)
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

		const result = await registerDocumentDefaultHandlers({
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
					handlers: {
						"public.markdown": null,
						"net.daringfireball.markdown": null,
					},
					explicitUserDefaults: [],
				}),
			})
			.mockResolvedValueOnce({ stdout: "" });

		const result = await registerDocumentDefaultHandlers({
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
					handlers: {
						"public.markdown": null,
						"net.daringfireball.markdown": "com.microsoft.VSCode",
					},
					explicitUserDefaults: [],
				}),
			})
			.mockResolvedValueOnce({ stdout: "" });

		const result = await registerDocumentDefaultHandlers({
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
					handlers: {
						"public.markdown": "com.microsoft.VSCode",
						"net.daringfireball.markdown": "md.obsidian",
					},
					explicitUserDefaults: [],
				}),
			});

		const result = await registerDocumentDefaultHandlers({
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

describe("CSV default handler registration", () => {
	const csv = "public.comma-separated-values-text";
	test("claims CSV when unassigned or when Numbers is only the system fallback", () => {
		expect(getDocumentContentTypesToRegister({ [csv]: null })).toEqual([csv]);
		expect(
			getDocumentContentTypesToRegister({
				[csv]: "com.apple.iWork.Numbers",
			}),
		).toEqual([csv]);
		expect(
			getDocumentContentTypesToRegister({ [csv]: "com.apple.iWork.Numbers" }, [
				csv,
			]),
		).toEqual([]);
		for (const handler of [
			"com.microsoft.Excel",
			"com.apple.TextEdit",
			"com.apple.dt.Xcode",
			"com.microsoft.VSCode",
		]) {
			expect(getDocumentContentTypesToRegister({ [csv]: handler })).toEqual([]);
		}
		expect(getDocumentContentTypesToRegister({ [csv]: APP_BUNDLE_ID })).toEqual(
			[csv],
		);
		expect(getDocumentContentTypesToRegister({})).toEqual([]);
	});
	test("registers CSV through the shared workflow without claiming Markdown", async () => {
		const execFileAsync = vi
			.fn()
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					handlers: {
						"public.markdown": "com.microsoft.VSCode",
						"net.daringfireball.markdown": "com.apple.TextEdit",
						[csv]: null,
					},
					explicitUserDefaults: [],
				}),
			})
			.mockResolvedValueOnce({ stdout: "" });
		const result = await registerDocumentDefaultHandlers({
			execFileAsync,
			executablePath: "/Applications/Flashtype.app/Contents/MacOS/Flashtype",
			isPackaged: true,
			platform: "darwin",
		});
		expect(result).toMatchObject({ status: "registered", contentTypes: [csv] });
		expect(execFileAsync.mock.calls[2][1][3]).toContain(csv);
		const registration = execFileAsync.mock.calls[3][1][3];
		expect(registration).toContain(csv);
		expect(registration).not.toContain('"public.markdown"');

		const query = execFileAsync.mock.calls[2][1][3];
		const csvPreference = {
			LSHandlerContentTag: "CSV",
			LSHandlerContentTagClass: "public.filename-extension",
			LSHandlerRoleEditor: "com.apple.iWork.Numbers",
		};
		const queryOutput = vi.fn();
		const query$ = Object.assign((value: unknown) => value, {
			kLSRolesEditor: 4,
			LSCopyDefaultRoleHandlerForContentType: (contentType: string) =>
				contentType === csv ? "com.apple.iWork.Numbers" : null,
			NSString: { stringWithString: (value: string) => value },
			NSUserDefaults: {
				standardUserDefaults: {
					persistentDomainForName: () => ({ LSHandlers: [csvPreference] }),
				},
			},
		});
		runInNewContext(query, {
			$: query$,
			ObjC: {
				import: () => {},
				deepUnwrap: (value: unknown) => value,
				unwrap: (value: unknown) => value,
				castRefToObject: (value: unknown) => value,
			},
			console: { log: queryOutput },
		});
		expect(JSON.parse(queryOutput.mock.calls[0][0])).toMatchObject({
			handlers: { [csv]: "com.apple.iWork.Numbers" },
			explicitUserDefaults: [csv],
		});

		// Execute the generated JXA logic with CoreServices mocked: a late user
		// override must survive even after the first query said CSV was unassigned.
		const set = vi.fn().mockReturnValue(0);
		const $ = Object.assign((value: unknown) => value, {
			kLSRolesEditor: 4,
			LSCopyDefaultRoleHandlerForContentType: () => "com.microsoft.Excel",
			LSSetDefaultRoleHandlerForContentType: set,
			NSString: { stringWithString: (value: string) => value },
			NSUserDefaults: {
				standardUserDefaults: {
					persistentDomainForName: () => ({ LSHandlers: [] }),
				},
			},
		});
		runInNewContext(registration, {
			$,
			ObjC: {
				import: () => {},
				deepUnwrap: (value: unknown) => value,
				unwrap: (value: unknown) => value,
				castRefToObject: (value: unknown) => value,
			},
		});
		expect(set).not.toHaveBeenCalled();

		const setNumbersFallback = vi.fn().mockReturnValue(0);
		const numbersFallback = Object.assign((value: unknown) => value, {
			kLSRolesEditor: 4,
			LSCopyDefaultRoleHandlerForContentType: () => "com.apple.iWork.Numbers",
			LSSetDefaultRoleHandlerForContentType: setNumbersFallback,
			NSString: { stringWithString: (value: string) => value },
			NSUserDefaults: {
				standardUserDefaults: {
					persistentDomainForName: () => ({ LSHandlers: [] }),
				},
			},
		});
		runInNewContext(registration, {
			$: numbersFallback,
			ObjC: {
				import: () => {},
				deepUnwrap: (value: unknown) => value,
				unwrap: (value: unknown) => value,
				castRefToObject: (value: unknown) => value,
			},
		});
		expect(setNumbersFallback).toHaveBeenCalledWith(
			expect.anything(),
			4,
			APP_BUNDLE_ID,
		);
	});
	test("keeps a user-selected Numbers default during the late registration check", async () => {
		const execFileAsync = vi
			.fn()
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({ stdout: "" })
			.mockResolvedValueOnce({
				stdout: JSON.stringify({
					handlers: { [csv]: "com.apple.iWork.Numbers" },
					explicitUserDefaults: [],
				}),
			})
			.mockResolvedValueOnce({ stdout: "" });
		await registerDocumentDefaultHandlers({
			execFileAsync,
			executablePath: "/Applications/Flashtype.app/Contents/MacOS/Flashtype",
			isPackaged: true,
			platform: "darwin",
		});
		const registration = execFileAsync.mock.calls[3][1][3];
		const set = vi.fn().mockReturnValue(0);
		const $ = Object.assign((value: unknown) => value, {
			kLSRolesEditor: 4,
			LSCopyDefaultRoleHandlerForContentType: () => "com.apple.iWork.Numbers",
			LSSetDefaultRoleHandlerForContentType: set,
			NSString: { stringWithString: (value: string) => value },
			NSUserDefaults: {
				standardUserDefaults: {
					persistentDomainForName: () => ({
						LSHandlers: [
							{
								LSHandlerContentType: csv,
								LSHandlerRoleEditor: "com.apple.iWork.Numbers",
							},
						],
					}),
				},
			},
		});
		runInNewContext(registration, {
			$,
			ObjC: {
				import: () => {},
				deepUnwrap: (value: unknown) => value,
				unwrap: (value: unknown) => value,
				castRefToObject: (value: unknown) => value,
			},
		});
		expect(set).not.toHaveBeenCalled();
	});
	test("does not change system defaults from a development runtime", async () => {
		const execFileAsync = vi.fn();
		expect(
			await registerDocumentDefaultHandlers({
				execFileAsync,
				executablePath: "/Applications/Flashtype.app/Contents/MacOS/Flashtype",
				isPackaged: false,
				platform: "darwin",
			}),
		).toMatchObject({ status: "skipped" });
		expect(execFileAsync).not.toHaveBeenCalled();
	});
});
