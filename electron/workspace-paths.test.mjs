import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import {
	resolveMarkdownImageSrc,
	TRANSPARENT_GIF_DATA_URL,
} from "./workspace-paths.mjs";

describe("resolveMarkdownImageSrc", () => {
	test("uses http and https image URLs directly", () => {
		const context = {
			sourceFilePath: "/docs/readme.md",
			workspacePath: "/Users/alec/project",
		};

		expect(
			resolveMarkdownImageSrc({
				...context,
				src: "https://example.com/logo.png?size=2#preview",
			}),
		).toBe("https://example.com/logo.png?size=2#preview");
		expect(
			resolveMarkdownImageSrc({
				...context,
				src: "http://example.com/logo.png",
			}),
		).toBe("http://example.com/logo.png");
	});

	test("resolves non-http image paths relative to the markdown file path", () => {
		const workspacePath = path.join("/Users/alec", "project");
		const expectedPath = path.join(
			workspacePath,
			"docs",
			"assets",
			"product shot.png",
		);

		expect(
			resolveMarkdownImageSrc({
				src: "../assets/product shot.png?raw#preview",
				sourceFilePath: "/docs/guides/readme.md",
				workspacePath,
			}),
		).toBe(`${pathToFileURL(expectedPath).href}?raw#preview`);
	});

	test("uses a transparent gif when the normalized image path leaves the workspace", () => {
		expect(
			resolveMarkdownImageSrc({
				src: "../outside.png",
				sourceFilePath: "/readme.md",
				workspacePath: "/Users/alec/project",
			}),
		).toBe(TRANSPARENT_GIF_DATA_URL);
	});

	test("uses a transparent gif for non-http absolute URLs", () => {
		const workspacePath = "/Users/alec/project";
		expect(
			resolveMarkdownImageSrc({
				src: "data:image/png;base64,abc",
				sourceFilePath: "/docs/readme.md",
				workspacePath,
			}),
		).toBe(TRANSPARENT_GIF_DATA_URL);
		expect(
			resolveMarkdownImageSrc({
				src: pathToFileURL(path.join(workspacePath, "docs", "logo.png")).href,
				sourceFilePath: "/docs/readme.md",
				workspacePath,
			}),
		).toBe(TRANSPARENT_GIF_DATA_URL);
	});
});
