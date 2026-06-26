import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TRANSPARENT_GIF_DATA_URL =
	"data:image/gif;base64,R0lGODlhAQABAIABAP///wAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

export function workspaceRelativeFilePath(workspacePath, filePath) {
	const workspaceRoot = path.resolve(workspacePath);
	const resolvedFilePath = path.resolve(filePath);
	const relativePath = path.relative(workspaceRoot, resolvedFilePath);
	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relativePath)
	) {
		return null;
	}
	const segments = path
		.normalize(relativePath)
		.split(path.sep)
		.filter((segment) => segment.length > 0);
	if (!isValidRelativePathSegments(segments)) {
		return null;
	}
	if (segments[0] === ".lix") {
		return null;
	}
	return segments.join("/");
}

export function workspaceLocalFilePath(workspacePath, relativeFilePath) {
	if (!isWorkspaceRelativeFilePath(relativeFilePath)) {
		return null;
	}
	return path.join(workspacePath, ...relativeFilePath.split("/"));
}

export function isWorkspaceRelativeFilePath(relativeFilePath) {
	if (
		typeof relativeFilePath !== "string" ||
		relativeFilePath.length === 0 ||
		relativeFilePath.startsWith("/") ||
		relativeFilePath.endsWith("/") ||
		path.isAbsolute(relativeFilePath)
	) {
		return false;
	}
	const segments = relativeFilePath.split("/");
	return isValidRelativePathSegments(segments) && segments[0] !== ".lix";
}

export function uniqueWorkspaceRelativeFilePaths(filePaths) {
	const seen = new Set();
	const uniqueFilePaths = [];
	for (const filePath of filePaths ?? []) {
		if (!isWorkspaceRelativeFilePath(filePath) || seen.has(filePath)) {
			continue;
		}
		seen.add(filePath);
		uniqueFilePaths.push(filePath);
	}
	return uniqueFilePaths;
}

export function resolveMarkdownImageSrc(payload) {
	const src = typeof payload?.src === "string" ? payload.src : "";
	if (src.length === 0) {
		return TRANSPARENT_GIF_DATA_URL;
	}

	const absoluteUrl = parseUrl(src);
	if (absoluteUrl?.protocol === "http:" || absoluteUrl?.protocol === "https:") {
		return src;
	}
	if (absoluteUrl) {
		return TRANSPARENT_GIF_DATA_URL;
	}

	const workspacePath =
		typeof payload?.workspacePath === "string" ? payload.workspacePath : "";
	const sourceFilePath =
		typeof payload?.sourceFilePath === "string" ? payload.sourceFilePath : "";
	const sourceLocalFilePath = workspaceLocalFilePathForSource(
		workspacePath,
		sourceFilePath,
	);
	if (!sourceLocalFilePath) {
		return TRANSPARENT_GIF_DATA_URL;
	}

	const workspaceRootRelative = path.posix.isAbsolute(src);
	const imageUrl = workspaceRootRelative
		? parseUrl(
				path.posix.relative("/", src),
				workspaceRootFileUrl(workspacePath),
			)
		: parseUrl(src, pathToFileURL(sourceLocalFilePath));
	if (!imageUrl || imageUrl.protocol !== "file:") {
		return TRANSPARENT_GIF_DATA_URL;
	}

	let imageLocalFilePath;
	try {
		imageLocalFilePath = fileURLToPath(imageUrl);
	} catch {
		return TRANSPARENT_GIF_DATA_URL;
	}

	const imageWorkspaceRelativePath = workspaceRelativeFilePath(
		workspacePath,
		imageLocalFilePath,
	);
	if (!imageWorkspaceRelativePath) {
		return TRANSPARENT_GIF_DATA_URL;
	}

	const normalizedImageLocalFilePath = workspaceLocalFilePath(
		workspacePath,
		imageWorkspaceRelativePath,
	);
	if (!normalizedImageLocalFilePath) {
		return TRANSPARENT_GIF_DATA_URL;
	}

	const normalizedImageUrl = pathToFileURL(normalizedImageLocalFilePath);
	normalizedImageUrl.search = imageUrl.search;
	normalizedImageUrl.hash = imageUrl.hash;
	return normalizedImageUrl.href;
}

function workspaceLocalFilePathForSource(workspacePath, sourceFilePath) {
	if (!workspacePath || !sourceFilePath) {
		return null;
	}

	const sourceWorkspaceRelativePath = sourceFilePath.startsWith("/")
		? sourceFilePath.slice(1)
		: sourceFilePath;
	const sourceLocalFilePath = workspaceLocalFilePath(
		workspacePath,
		sourceWorkspaceRelativePath,
	);
	if (!sourceLocalFilePath) {
		return null;
	}

	return workspaceRelativeFilePath(workspacePath, sourceLocalFilePath)
		? sourceLocalFilePath
		: null;
}

function parseUrl(value, base) {
	try {
		return base ? new URL(value, base) : new URL(value);
	} catch {
		return null;
	}
}

function workspaceRootFileUrl(workspacePath) {
	return pathToFileURL(path.join(path.resolve(workspacePath), path.sep));
}

function isValidRelativePathSegments(segments) {
	return (
		segments.length > 0 &&
		segments.every(
			(segment) =>
				segment.length > 0 &&
				segment !== "." &&
				segment !== ".." &&
				!segment.includes(path.sep) &&
				!path.isAbsolute(segment),
		)
	);
}
