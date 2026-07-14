import "@testing-library/jest-dom";
import { readFile } from "node:fs/promises";
import path from "node:path";

const originalFetch = globalThis.fetch.bind(globalThis);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function asUrl(input: RequestInfo | URL): URL | undefined {
	try {
		if (typeof input === "string") {
			return new URL(input, "http://localhost");
		}
		if (input instanceof URL) {
			return input;
		}
		return new URL(input.url);
	} catch {
		return undefined;
	}
}

function localFilePathForSdkAsset(url: URL): string | undefined {
	if (!LOCAL_HOSTS.has(url.hostname)) {
		return undefined;
	}

	const pathname = decodeURIComponent(url.pathname);
	if (pathname.startsWith("/@fs/")) {
		return pathname.slice("/@fs".length);
	}

	// Vitest + happy-dom can resolve import.meta.url in linked workspaces to
	// localhost /submodule/... roots, which should map to cwd-relative files.
	if (pathname.startsWith("/submodule/")) {
		const relativePath = path.posix.relative("/", pathname);
		return path.join(process.cwd(), relativePath);
	}

	return undefined;
}

function contentTypeFor(pathname: string): string {
	if (pathname.endsWith(".wasm")) return "application/wasm";
	if (pathname.endsWith(".js")) return "text/javascript";
	return "application/octet-stream";
}

globalThis.fetch = (async (
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	const url = asUrl(input);
	if (url) {
		const localPath = localFilePathForSdkAsset(url);
		if (localPath) {
			try {
				const bytes = await readFile(localPath);
				return new Response(bytes, {
					status: 200,
					headers: {
						"Content-Type": contentTypeFor(localPath),
					},
				});
			} catch {
				// Fall through to default fetch for non-existing files.
			}
		}
	}
	return originalFetch(input as RequestInfo, init);
}) as typeof globalThis.fetch;
