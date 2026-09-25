import path from "node:path";

export const APP_BUNDLE_ID = "com.flashtype.app";
export const APPLE_NUMBERS_BUNDLE_ID = "com.apple.iWork.Numbers";
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

// Preserve an explicitly selected app. CSV's uncustomized Numbers fallback is
// handled separately after checking the user's LaunchServices preferences.
export function shouldReplaceDocumentDefaultHandler(handlerBundleId) {
	return (
		handlerBundleId == null || handlerBundleId.toLowerCase() === APP_BUNDLE_ID
	);
}

export function getDocumentContentTypesToRegister(
	currentHandlers,
	explicitUserDefaults = [],
) {
	return DOCUMENT_CONTENT_TYPES.filter((contentType) => {
		if (!Object.hasOwn(currentHandlers, contentType)) return false;
		const handler = currentHandlers[contentType];
		if (shouldReplaceDocumentDefaultHandler(handler)) return true;
		return (
			contentType === "public.comma-separated-values-text" &&
			handler?.toLowerCase() === APPLE_NUMBERS_BUNDLE_ID.toLowerCase() &&
			!explicitUserDefaults.includes(contentType)
		);
	});
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
ObjC.import("Foundation");
const contentTypes = ${JSON.stringify(DOCUMENT_CONTENT_TYPES)};
const csvContentType = "public.comma-separated-values-text";
const csvExtension = "csv";
const preferenceDomain = "com.apple.LaunchServices/com.apple.launchservices.secure";
const preferences = ObjC.deepUnwrap(
	$.NSUserDefaults.standardUserDefaults.persistentDomainForName(
		$.NSString.stringWithString(preferenceDomain)
	)
);
const savedHandlers = preferences && preferences.LSHandlers || [];
function hasExplicitUserDefault(contentType) {
	return savedHandlers.some(function(saved) {
		const matchesType = saved.LSHandlerContentType === contentType;
		const matchesCsvExtension = contentType === csvContentType &&
			saved.LSHandlerContentTagClass === "public.filename-extension" &&
			String(saved.LSHandlerContentTag || "").toLowerCase() === csvExtension;
		return (matchesType || matchesCsvExtension) &&
			(saved.LSHandlerRoleEditor || saved.LSHandlerRoleAll);
	});
}
const handlers = {};
for (const contentType of contentTypes) {
	const handler = $.LSCopyDefaultRoleHandlerForContentType(
		$(contentType),
		$.kLSRolesEditor
	);
	handlers[contentType] = handler ? ObjC.unwrap(ObjC.castRefToObject(handler)) : null;
}
const explicitUserDefaults = contentTypes.filter(hasExplicitUserDefault);
console.log(JSON.stringify({ handlers: handlers, explicitUserDefaults: explicitUserDefaults }));
`;
}

function buildDocumentHandlerRegistrationScript(contentTypes) {
	return `
ObjC.import("CoreServices");
ObjC.import("Foundation");
const bundleId = ${JSON.stringify(APP_BUNDLE_ID)};
const numbersBundleId = ${JSON.stringify(APPLE_NUMBERS_BUNDLE_ID)};
const csvContentType = "public.comma-separated-values-text";
const csvExtension = "csv";
const preferenceDomain = "com.apple.LaunchServices/com.apple.launchservices.secure";
const preferences = ObjC.deepUnwrap(
	$.NSUserDefaults.standardUserDefaults.persistentDomainForName(
		$.NSString.stringWithString(preferenceDomain)
	)
);
const savedHandlers = preferences && preferences.LSHandlers || [];
function hasExplicitCsvDefault() {
	return savedHandlers.some(function(saved) {
		const matchesType = saved.LSHandlerContentType === csvContentType;
		const matchesExtension = saved.LSHandlerContentTagClass === "public.filename-extension" &&
			String(saved.LSHandlerContentTag || "").toLowerCase() === csvExtension;
		return (matchesType || matchesExtension) &&
			(saved.LSHandlerRoleEditor || saved.LSHandlerRoleAll);
});
}
const contentTypes = ${JSON.stringify(contentTypes)};
for (const contentType of contentTypes) {
	// A user may have changed the default since the initial query.
	const current = $.LSCopyDefaultRoleHandlerForContentType($(contentType), $.kLSRolesEditor);
	if (current) {
		const currentBundleId = ObjC.unwrap(ObjC.castRefToObject(current)).toLowerCase();
		const isNumbersSystemFallback = contentType === csvContentType &&
			currentBundleId === numbersBundleId.toLowerCase() && !hasExplicitCsvDefault();
		if (currentBundleId !== bundleId && !isNumbersSystemFallback) continue;
	}
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

async function getCurrentDocumentDefaults(execFileAsync) {
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

	const { handlers, explicitUserDefaults } =
		await getCurrentDocumentDefaults(execFileAsync);
	const contentTypes = getDocumentContentTypesToRegister(
		handlers,
		explicitUserDefaults,
	);
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
