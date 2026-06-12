import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import { MessageSquare, Puzzle, type LucideIcon } from "lucide-react";
import type { WidgetContext, WidgetDefinition, WidgetInstance } from "./types";
import { normalizeFileExtensions } from "./file-handlers";

const WIDGET_ROOT = "/.lix_system/app_data/flashtype/widgets/";
const MANIFEST_SUFFIX = "/manifest.json";

type WidgetManifest = {
	id: string;
	name: string;
	description?: string;
	icon?: string;
	entry: string;
	fileExtensions?: string[];
};

type WidgetModuleContract = {
	activate?: (args: {
		context: WidgetContext;
		instance: WidgetInstance;
	}) => void | (() => void);
	render: (args: {
		context: WidgetContext;
		instance: WidgetInstance;
		target: HTMLElement;
	}) => void | (() => void);
};

type FileRow = {
	path: string;
	data: unknown;
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

function normalizePath(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/");
	const stack: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") {
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return `/${stack.join("/")}`;
}

function resolveWidgetEntryPath(manifestPath: string, entry: string): string {
	const widgetDir = manifestPath.slice(0, -MANIFEST_SUFFIX.length);
	const raw = entry.startsWith("./")
		? `${widgetDir}/${entry.slice(2)}`
		: `${widgetDir}/${entry}`;
	const resolved = normalizePath(raw);
	if (!resolved.startsWith(widgetDir + "/")) {
		throw new Error(`Widget entry escapes widget directory: ${entry}`);
	}
	return resolved;
}

export function parseManifest(
	manifestPath: string,
	manifestContent: string,
): WidgetManifest {
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
	const m = parsed as Partial<WidgetManifest>;
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
						(extension): extension is string =>
							typeof extension === "string",
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

async function importWidgetModule(
	sourceCode: string,
	sourcePath: string,
): Promise<WidgetModuleContract> {
	const blob = new Blob([sourceCode], { type: "text/javascript" });
	const url = URL.createObjectURL(blob);
	try {
		const mod = (await import(
			/* @vite-ignore */ `${url}#${encodeURIComponent(sourcePath)}`
		)) as any;
		const contract = (
			mod?.default && typeof mod.default === "object" ? mod.default : mod
		) as Partial<WidgetModuleContract>;
		if (typeof contract.render !== "function") {
			throw new Error("Widget module must export a render function.");
		}
		if (
			contract.activate !== undefined &&
			typeof contract.activate !== "function"
		) {
			throw new Error(
				"Widget activate export must be a function when present.",
			);
		}
		return contract as WidgetModuleContract;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function loadInstalledWidgetsFromLix(
	lix: Lix,
): Promise<WidgetDefinition[]> {
	const manifestRows = await selectFiles(
		lix,
		`${WIDGET_ROOT}%${MANIFEST_SUFFIX}`,
	);
	const fileRows = await selectFiles(lix, `${WIDGET_ROOT}%`);

	const filesByPath = new Map<string, FileRow>();
	for (const row of fileRows) {
		filesByPath.set(row.path, row);
	}

	const definitions: WidgetDefinition[] = [];

	for (const row of manifestRows) {
		try {
			const manifest = parseManifest(row.path, decodeFileData(row.data));
			const entryPath = resolveWidgetEntryPath(row.path, manifest.entry);
			const entryRow = filesByPath.get(entryPath);
			if (!entryRow) {
				throw new Error(`Missing widget entry file: ${entryPath}`);
			}
			const module = await importWidgetModule(
				decodeFileData(entryRow.data),
				entryPath,
			);
			const icon = iconFromManifest(manifest.icon);
			definitions.push({
				kind: manifest.id,
				label: manifest.name,
				description:
					manifest.description ?? `Installed widget: ${manifest.name}`,
				icon,
				fileExtensions: manifest.fileExtensions,
				activate: module.activate,
				render: module.render,
			});
		} catch (error) {
			console.warn(
				`[widget-loader] Failed to load widget from ${row.path}:`,
				error,
			);
		}
	}

	return definitions;
}

async function selectFiles(lix: Lix, pathLike: string): Promise<FileRow[]> {
	return qb(lix)
		.selectFrom("lix_file_by_branch")
		.select(["path", "data"])
		.where("lixcol_branch_id", "=", "global")
		.where("path", "like", pathLike)
		.execute() as Promise<FileRow[]>;
}
