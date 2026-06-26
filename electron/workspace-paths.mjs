import path from "node:path";

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
