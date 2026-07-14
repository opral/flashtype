export function fileExtensionFromPath(filePath: string): string | undefined {
	const name = filePath.split("/").pop() ?? filePath;
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === name.length - 1) return undefined;
	return name.slice(dotIndex + 1).toLowerCase();
}

export function isMarkdownFilePath(filePath: string): boolean {
	const extension = fileExtensionFromPath(filePath);
	return extension === "md" || extension === "markdown";
}
