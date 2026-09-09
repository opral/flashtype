import path from "node:path";

export const APP_BUNDLE_ID = "com.flashtype.app";
export const APP_NAME = "Flashtype";
export const DOCUMENT_CONTENT_TYPES = [
	"public.markdown",
	"net.daringfireball.markdown",
	"public.comma-separated-values-text",
];

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

// LaunchServices does not distinguish a fallback from a deliberate user choice.
// Preserve every other app, including Apple apps; never reclaim a changed default.
export function shouldReplaceDocumentDefaultHandler(handlerBundleId) {
	return (
		handlerBundleId == null || handlerBundleId.toLowerCase() === APP_BUNDLE_ID
	);
}

export function getDocumentContentTypesToRegister(currentHandlers) {
	return DOCUMENT_CONTENT_TYPES.filter(
		(contentType) =>
			Object.hasOwn(currentHandlers, contentType) &&
			shouldReplaceDocumentDefaultHandler(currentHandlers[contentType]),
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

function buildDocumentHandlerQueryScript() {
	return `
ObjC.import("CoreServices");
const contentTypes = ${JSON.stringify(DOCUMENT_CONTENT_TYPES)};
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

function buildDocumentHandlerRegistrationScript(contentTypes) {
	return `
ObjC.import("CoreServices");
const bundleId = ${JSON.stringify(APP_BUNDLE_ID)};
const contentTypes = ${JSON.stringify(contentTypes)};
for (const contentType of contentTypes) {
	// A user may have changed the default since the initial query.
	const current = $.LSCopyDefaultRoleHandlerForContentType($(contentType), $.kLSRolesEditor);
	if (current && ObjC.unwrap(ObjC.castRefToObject(current)).toLowerCase() !== bundleId) continue;
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

async function getCurrentDocumentDefaultHandlers(execFileAsync) {
	const { stdout } = await execFileAsync(
		"/usr/bin/osascript",
		["-l", "JavaScript", "-e", buildDocumentHandlerQueryScript()],
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

export async function registerDocumentDefaultHandlers({
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
		await getCurrentDocumentDefaultHandlers(execFileAsync);
	const contentTypes = getDocumentContentTypesToRegister(currentHandlers);
	if (contentTypes.length === 0) {
		return { status: "skipped", reason: "user-handler-preserved" };
	}

	await execFileAsync(
		"/usr/bin/osascript",
		[
			"-l",
			"JavaScript",
			"-e",
			buildDocumentHandlerRegistrationScript(contentTypes),
		],
		{ timeout: 5000 },
	);

	return { status: "registered", contentTypes, unregisteredAppBundlePaths };
}
