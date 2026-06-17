import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { MessageSquare, Puzzle, type LucideIcon } from "lucide-react";
import type {
	ExtensionContext,
	ExtensionDefinition,
	ExtensionInstance,
} from "./types";
import { normalizeFileExtensions } from "./file-handlers";

const EXTENSION_ROOT = "/.lix_system/app_data/flashtype/extensions/";
const EXTENSION_ROOT_UPPER_BOUND =
	"/.lix_system/app_data/flashtype/extensions0";
const MANIFEST_SUFFIX = "/manifest.json";

type ExtensionManifest = {
	id: string;
	name: string;
	description?: string;
	icon?: string;
	entry: string;
	fileExtensions?: string[];
};

type ExtensionModuleContract = {
	activate?: (args: {
		context: ExtensionContext;
		instance: ExtensionInstance;
	}) => void | (() => void);
	render: (args: {
		context: ExtensionContext;
		instance: ExtensionInstance;
		target: HTMLElement;
	}) => void | (() => void);
};

type FileRow = {
	path: string;
	data: unknown;
};

type LoadInstalledExtensionsOptions = {
	readonly importModule?: typeof importExtensionModule;
};

const textDecoder = new TextDecoder();
const lucideByName = Object.fromEntries(
	Object.entries({ Puzzle, MessageSquare }).map(([k, v]) => [
		k.toLowerCase(),
		v,
	]),
) as Record<string, LucideIcon>;

function unwrapSerializedValue(value: unknown): unknown {
	if (
		value &&
		typeof value === "object" &&
		"kind" in (value as Record<string, unknown>) &&
		"value" in (value as Record<string, unknown>)
	) {
		return (value as { value: unknown }).value;
	}
	return value;
}

function decodeFileData(data: FileRow["data"]): string {
	const raw = unwrapSerializedValue(data);
	if (raw === null || raw === undefined) {
		throw new Error("Expected non-null file data.");
	}
	if (typeof raw === "string") return raw;
	if (raw instanceof Uint8Array) return textDecoder.decode(raw);
	if (raw instanceof ArrayBuffer)
		return textDecoder.decode(new Uint8Array(raw));
	if (ArrayBuffer.isView(raw)) {
		return textDecoder.decode(
			new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
		);
	}
	if (Array.isArray(raw)) {
		return textDecoder.decode(Uint8Array.from(raw as number[]));
	}
	throw new Error("Expected file data as string or binary.");
}

function normalizePortableRelativePath(path: string, context: string): string {
	const relative = path.startsWith("./") ? path.slice(2) : path;
	if (!relative) {
		throw new Error(`${context} must be non-empty.`);
	}
	if (relative.startsWith("/") || relative.startsWith("\\")) {
		throw new Error(`${context} must be relative.`);
	}
	if (relative.includes("\\")) {
		throw new Error(`${context} must use forward slash separators.`);
	}
	const segments = relative.split("/");
	if (segments.some((segment) => segment.length === 0)) {
		throw new Error(`${context} must not contain empty path segments.`);
	}
	if (segments.some((segment) => segment === "." || segment === "..")) {
		throw new Error(`${context} must not contain '.' or '..' segments.`);
	}
	return relative;
}

function resolveExtensionEntryPath(
	manifestPath: string,
	entry: string,
): string {
	const extensionDir = manifestPath.slice(0, -MANIFEST_SUFFIX.length);
	const relativeEntry = normalizePortableRelativePath(entry, "Extension entry");
	return `${extensionDir}/${relativeEntry}`;
}

export function parseManifest(
	manifestPath: string,
	manifestContent: string,
): ExtensionManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(manifestContent);
	} catch (error) {
		throw new Error(
			`Invalid manifest JSON at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Manifest at ${manifestPath} must be an object.`);
	}
	const m = parsed as Partial<ExtensionManifest>;
	if (!m.id || !m.name || !m.entry) {
		throw new Error(
			`Manifest at ${manifestPath} must include non-empty id, name, and entry.`,
		);
	}
	return {
		id: String(m.id),
		name: String(m.name),
		description: m.description ? String(m.description) : undefined,
		icon: m.icon ? String(m.icon) : undefined,
		entry: String(m.entry),
		fileExtensions: Array.isArray(m.fileExtensions)
			? normalizeFileExtensions(
					m.fileExtensions.filter(
						(extension): extension is string => typeof extension === "string",
					),
				)
			: undefined,
	};
}

function iconFromManifest(iconName?: string): LucideIcon {
	if (!iconName) return Puzzle;
	const normalized = iconName
		.trim()
		.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
	const pascal = normalized[0]?.toUpperCase() + normalized.slice(1);
	const direct = lucideByName[pascal.toLowerCase()];
	if (direct) return direct;
	return Puzzle;
}

async function importExtensionModule(
	sourceCode: string,
	sourcePath: string,
): Promise<ExtensionModuleContract> {
	const blob = new Blob([sourceCode], { type: "text/javascript" });
	const url = URL.createObjectURL(blob);
	try {
		const mod = (await import(
			/* @vite-ignore */ `${url}#${encodeURIComponent(sourcePath)}`
		)) as any;
		const contract = (
			mod?.default && typeof mod.default === "object" ? mod.default : mod
		) as Partial<ExtensionModuleContract>;
		if (typeof contract.render !== "function") {
			throw new Error("Extension module must export a render function.");
		}
		if (
			contract.activate !== undefined &&
			typeof contract.activate !== "function"
		) {
			throw new Error(
				"Extension activate export must be a function when present.",
			);
		}
		return contract as ExtensionModuleContract;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function loadInstalledExtensionsFromLix(
	lix: Lix,
	options: LoadInstalledExtensionsOptions = {},
): Promise<ExtensionDefinition[]> {
	const importModule = options.importModule ?? importExtensionModule;
	const fileRows = await selectFilesUnderExtensionRoot(lix);
	const manifestRows = fileRows.filter((row) =>
		row.path.endsWith(MANIFEST_SUFFIX),
	);

	const filesByPath = new Map<string, FileRow>();
	for (const row of fileRows) {
		filesByPath.set(row.path, row);
	}

	const definitions: ExtensionDefinition[] = [];

	for (const row of manifestRows) {
		try {
			const manifest = parseManifest(row.path, decodeFileData(row.data));
			const entryPath = resolveExtensionEntryPath(row.path, manifest.entry);
			const entryRow = filesByPath.get(entryPath);
			if (!entryRow) {
				throw new Error(`Missing extension entry file: ${entryPath}`);
			}
			const module = await importModule(
				decodeFileData(entryRow.data),
				entryPath,
			);
			const icon = iconFromManifest(manifest.icon);
			definitions.push({
				kind: manifest.id,
				label: manifest.name,
				description:
					manifest.description ?? `Installed extension: ${manifest.name}`,
				icon,
				fileExtensions: manifest.fileExtensions,
				activate: module.activate,
				render: module.render,
			});
		} catch (error) {
			console.warn(
				`[extension-loader] Failed to load extension from ${row.path}:`,
				error,
			);
		}
	}

	return definitions;
}

async function selectFilesUnderExtensionRoot(lix: Lix): Promise<FileRow[]> {
	return qb(lix)
		.selectFrom("lix_file_by_branch")
		.select(["path", "data"])
		.where("lixcol_branch_id", "=", "global")
		.where("path", ">=", EXTENSION_ROOT)
		.where("path", "<", EXTENSION_ROOT_UPPER_BOUND)
		.execute() as Promise<FileRow[]>;
}
