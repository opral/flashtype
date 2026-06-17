import path from "node:path";

export const APP_BUNDLE_ID = "com.flashtype.app";
export const APP_NAME = "Flashtype";
export const MARKDOWN_CONTENT_TYPES = [
	"public.markdown",
	"net.daringfireball.markdown",
];

export const REPLACEABLE_MARKDOWN_HANDLER_BUNDLE_IDS = new Set([
	APP_BUNDLE_ID,
	"com.apple.dt.Xcode",
	"com.apple.TextEdit",
]);

export const LSREGISTER_PATH =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export function getAppBundlePathFromExecutablePath(executablePath) {
	const marker = ".app/Contents/MacOS/";
	const markerIndex = executablePath.indexOf(marker);
	if (markerIndex === -1) {
		return null;
	}
	return executablePath.slice(0, markerIndex + ".app".length);
}

export function isCanonicalInstalledAppBundle(appBundlePath) {
	if (!appBundlePath) {
		return false;
	}
	return (
		path.resolve(appBundlePath) === path.resolve("/Applications/Flashtype.app")
	);
}

export function shouldReplaceMarkdownDefaultHandler(handlerBundleId) {
	return (
		handlerBundleId == null ||
		REPLACEABLE_MARKDOWN_HANDLER_BUNDLE_IDS.has(handlerBundleId)
	);
}

export function getMarkdownContentTypesToRegister(currentHandlers) {
	return MARKDOWN_CONTENT_TYPES.filter((contentType) =>
		shouldReplaceMarkdownDefaultHandler(currentHandlers[contentType] ?? null),
	);
}

export function getNonCanonicalFlashtypeBundlePathsFromLsregisterDump(dump) {
	const blocks = dump.split(/\n-{20,}\n/u);
	return blocks.flatMap((block) => {
		const identifierMatch = block.match(/^identifier:\s+(.+)$/mu);
		if (!identifierMatch || identifierMatch[1] !== APP_BUNDLE_ID) {
			return [];
		}

		const pathMatch = block.match(
			/^path:\s+(.+?)(?:\s+\(0x[0-9a-fA-F]+\))?$/mu,
		);
		if (!pathMatch) {
			return [];
		}

		const appBundlePath = pathMatch[1];
		return isCanonicalInstalledAppBundle(appBundlePath) ? [] : [appBundlePath];
	});
}

function buildMarkdownHandlerQueryScript() {
	return `
ObjC.import("CoreServices");
const contentTypes = ${JSON.stringify(MARKDOWN_CONTENT_TYPES)};
const handlers = {};
for (const contentType of contentTypes) {
	const handler = $.LSCopyDefaultRoleHandlerForContentType(
		$(contentType),
		$.kLSRolesEditor
	);
	handlers[contentType] = handler ? ObjC.unwrap(ObjC.castRefToObject(handler)) : null;
}
console.log(JSON.stringify(handlers));
`;
}

function buildMarkdownHandlerRegistrationScript(contentTypes) {
	return `
ObjC.import("CoreServices");
const bundleId = ${JSON.stringify(APP_BUNDLE_ID)};
const contentTypes = ${JSON.stringify(contentTypes)};
for (const contentType of contentTypes) {
	const status = $.LSSetDefaultRoleHandlerForContentType(
		$(contentType),
		$.kLSRolesEditor,
		$(bundleId)
	);
	if (status !== 0) {
		throw new Error("LSSetDefaultRoleHandlerForContentType failed for " + contentType + ": " + status);
	}
}
`;
}

async function getCurrentMarkdownDefaultHandlers(execFileAsync) {
	const { stdout } = await execFileAsync(
		"/usr/bin/osascript",
		["-l", "JavaScript", "-e", buildMarkdownHandlerQueryScript()],
		{ timeout: 5000 },
	);
	return JSON.parse(stdout);
}

async function unregisterNonCanonicalFlashtypeBundles(execFileAsync) {
	const { stdout } = await execFileAsync(LSREGISTER_PATH, ["-dump"], {
		timeout: 5000,
		maxBuffer: 20 * 1024 * 1024,
	});
	const appBundlePaths =
		getNonCanonicalFlashtypeBundlePathsFromLsregisterDump(stdout);

	await Promise.all(
		appBundlePaths.map(async (appBundlePath) => {
			try {
				await execFileAsync(LSREGISTER_PATH, ["-u", appBundlePath], {
					timeout: 5000,
				});
			} catch {
				// Stale LaunchServices entries can point at unmounted DMGs or deleted
				// builds. Keep going so the canonical app can still be refreshed.
			}
		}),
	);

	return appBundlePaths;
}

export async function registerMarkdownDefaultHandler({
	execFileAsync,
	executablePath,
	isPackaged,
	platform,
}) {
	if (platform !== "darwin" || !isPackaged) {
		return { status: "skipped", reason: "unsupported-runtime" };
	}

	const appBundlePath = getAppBundlePathFromExecutablePath(executablePath);
	if (!isCanonicalInstalledAppBundle(appBundlePath)) {
		return { status: "skipped", reason: "non-canonical-app-bundle" };
	}

	const unregisteredAppBundlePaths =
		await unregisterNonCanonicalFlashtypeBundles(execFileAsync);

	await execFileAsync(LSREGISTER_PATH, ["-f", appBundlePath], {
		timeout: 5000,
	});

	const currentHandlers =
		await getCurrentMarkdownDefaultHandlers(execFileAsync);
	const contentTypes = getMarkdownContentTypesToRegister(currentHandlers);
	if (contentTypes.length === 0) {
		return { status: "skipped", reason: "user-handler-preserved" };
	}

	await execFileAsync(
		"/usr/bin/osascript",
		[
			"-l",
			"JavaScript",
			"-e",
			buildMarkdownHandlerRegistrationScript(contentTypes),
		],
		{ timeout: 5000 },
	);

	return { status: "registered", contentTypes, unregisteredAppBundlePaths };
}
