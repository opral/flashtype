import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import {
	captureTelemetryAsync,
	normalizeTelemetryFileExtension,
	workspaceTelemetryProperties,
} from "@/lib/telemetry";

const INTERNAL_WORKSPACE_PATH_PREFIX = "/.lix/";
const WORKSPACE_PROFILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type WorkspaceProfile = {
	fileCount: number;
	directoryCount: number;
	extensionCount: number;
	extensionCounts: Record<string, number>;
	totalSizeMb?: number;
	extensions?: WorkspaceExtensionProfile[];
};

type WorkspaceExtensionProfile = {
	fileExtension: string;
	fileCount: number;
	totalSizeMb: number;
	medianFileSizeKb: number;
};

export async function captureWorkspaceProfile(args: { lix: Lix }) {
	const workspaceId = await readWorkspaceId(args.lix);
	if (!workspaceId) {
		return;
	}

	if (!isWorkspaceProfileDue(workspaceId)) {
		return;
	}

	const profile = await readWorkspaceProfile(args.lix);
	try {
		await captureTelemetryAsync("workspace profiled", {
			workspace_id: workspaceId,
			file_count: profile.fileCount,
			directory_count: profile.directoryCount,
			extension_count: profile.extensionCount,
			extension_counts: profile.extensionCounts,
			total_size_mb: profile.totalSizeMb,
			...workspaceTelemetryProperties(workspaceId),
		});
		for (const extensionProfile of profile.extensions ?? []) {
			await captureTelemetryAsync("workspace extension profiled", {
				file_extension: extensionProfile.fileExtension,
				file_count: extensionProfile.fileCount,
				total_size_mb: extensionProfile.totalSizeMb,
				median_file_size_kb: extensionProfile.medianFileSizeKb,
				...workspaceTelemetryProperties(workspaceId),
			});
		}
	} finally {
		markWorkspaceProfiled(workspaceId);
	}
}

function isWorkspaceProfileDue(workspaceId: string) {
	const lastProfiledAt = Number(
		localStorage.getItem(workspaceProfileStorageKey(workspaceId)),
	);
	return (
		!Number.isFinite(lastProfiledAt) ||
		Date.now() - lastProfiledAt >= WORKSPACE_PROFILE_INTERVAL_MS
	);
}

function markWorkspaceProfiled(workspaceId: string) {
	localStorage.setItem(
		workspaceProfileStorageKey(workspaceId),
		String(Date.now()),
	);
}

function workspaceProfileStorageKey(workspaceId: string) {
	return `flashtype.workspaceProfiledAt.${workspaceId}`;
}

export function buildWorkspaceProfile(
	paths: readonly string[],
): WorkspaceProfile {
	const extensionCounts = new Map<string, number>();
	const directories = new Set<string>();

	for (const path of paths) {
		if (!isProfiledWorkspacePath(path)) {
			continue;
		}
		for (const directory of parentDirectories(path)) {
			directories.add(directory);
		}
		const extension = extensionFromPath(path);
		extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
	}

	const fileCount = Array.from(extensionCounts.values()).reduce(
		(total, count) => total + count,
		0,
	);
	return {
		fileCount,
		directoryCount: directories.size,
		extensionCount: extensionCounts.size,
		extensionCounts: Object.fromEntries(
			Array.from(extensionCounts.entries()).sort((left, right) =>
				left[0].localeCompare(right[0]),
			),
		),
	};
}

export async function readWorkspaceId(lix: Lix) {
	const row = await qb(lix)
		.selectFrom("lix_key_value")
		.select("value")
		.where("key", "=", "lix_id")
		.executeTakeFirst();
	return typeof row?.value === "string" && row.value.length > 0
		? row.value
		: undefined;
}

async function readWorkspaceProfile(lix: Lix): Promise<WorkspaceProfile> {
	const filesystemProfile = await window.flashtypeDesktop?.workspace
		.profile()
		.catch((error: unknown) => {
			console.warn("Failed to profile workspace filesystem", error);
			return null;
		});
	if (filesystemProfile) {
		return {
			fileCount: filesystemProfile.file_count,
			directoryCount: filesystemProfile.directory_count,
			extensionCount: filesystemProfile.extension_count,
			extensionCounts: filesystemProfile.extension_counts,
			totalSizeMb: filesystemProfile.total_size_mb,
			extensions: filesystemProfile.extensions.map((extension) => ({
				fileExtension: extension.file_extension,
				fileCount: extension.file_count,
				totalSizeMb: extension.total_size_mb,
				medianFileSizeKb: extension.median_file_size_kb,
			})),
		};
	}

	const filePaths = await readWorkspaceFilePaths(lix);
	return buildWorkspaceProfile(filePaths);
}

async function readWorkspaceFilePaths(lix: Lix) {
	const rows = await qb(lix).selectFrom("lix_file").select("path").execute();
	return rows
		.map((row) => row.path)
		.filter((path): path is string => typeof path === "string");
}

function isProfiledWorkspacePath(path: string) {
	return (
		path.startsWith("/") && !path.startsWith(INTERNAL_WORKSPACE_PATH_PREFIX)
	);
}

function extensionFromPath(path: string) {
	const fileName = path.split("/").pop() ?? path;
	const match = fileName.match(/\.([^./]+)$/);
	if (!match?.[1]) {
		return "(none)";
	}
	return normalizeTelemetryFileExtension(match[1]);
}

function parentDirectories(path: string) {
	const parts = path.split("/").filter(Boolean);
	const fileName = parts.pop();
	if (!fileName) {
		return [];
	}
	const directories: string[] = [];
	for (let index = 1; index <= parts.length; index += 1) {
		directories.push(parts.slice(0, index).join("/"));
	}
	return directories;
}
