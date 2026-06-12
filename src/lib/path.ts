const SEGMENT_CHARS = "[\\p{L}\\p{N}._~!$&'()*+,;=:@-]";
const SEGMENT = `${SEGMENT_CHARS}+`;

const FILE_PATH_REGEX = new RegExp(`^/(?:${SEGMENT}/)*${SEGMENT}$`, "u");
const DIRECTORY_PATH_REGEX = new RegExp(`^/(?:${SEGMENT}/)+$`, "u");

function isValidFilePath(path: string): boolean {
	if (!FILE_PATH_REGEX.test(path) || path === "/" || path.endsWith("/")) {
		return false;
	}
	return path
		.split("/")
		.filter(Boolean)
		.every((segment) => segment !== "." && segment !== "..");
}

function isValidDirectoryPath(path: string): boolean {
	if (!DIRECTORY_PATH_REGEX.test(path) || path === "/") {
		return false;
	}
	return path
		.split("/")
		.filter(Boolean)
		.every((segment) => segment !== "." && segment !== "..");
}

export function normalizeFilePath(path: string): string {
	const normalized = path.normalize("NFC");
	if (!isValidFilePath(normalized)) {
		throw new Error(`Invalid file path ${path}`);
	}
	return normalized;
}

export function normalizeDirectoryPath(path: string): string {
	const normalized = path.normalize("NFC");
	if (!isValidDirectoryPath(normalized)) {
		throw new Error(`Invalid directory path ${path}`);
	}
	return normalized;
}

export function isMarkdownFilePath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}
