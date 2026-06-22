import type { Lix } from "@/lib/lix-types";
import { qb } from "@/lib/lix-kysely";
import {
	captureTelemetryAsync,
	normalizeTelemetryFileExtension,
} from "@/lib/telemetry";

const INTERNAL_WORKSPACE_PATH_PREFIX = "/.lix/";
const WORKSPACE_PROFILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type WorkspaceProfile = {
	fileCount: number;
	directoryCount: number;
	extensionCount: number;
	extensionCounts: Record<string, number>;
	largestExtension?: string;
	largestExtensionFileCount?: number;
	largestExtensionShare?: number;
	extensions: WorkspaceExtensionProfile[];
};

type WorkspaceExtensionProfile = {
	fileExtension: string;
	fileCount: number;
	share: number;
	rank: number;
};

export async function captureWorkspaceProfile(args: {
	lix: Lix;
	isEphemeralWorkspace: boolean;
}) {
	const workspaceId = await readWorkspaceId(args.lix);
	if (!workspaceId) {
		return;
	}

	if (!isWorkspaceProfileDue(workspaceId)) {
		return;
	}

	const filePaths = await readWorkspaceFilePaths(args.lix);
	const profile = buildWorkspaceProfile(filePaths);
	const profileResult = await captureTelemetryAsync("workspace profiled", {
		workspace_id: workspaceId,
		file_count: profile.fileCount,
		directory_count: profile.directoryCount,
		extension_count: profile.extensionCount,
		extension_counts: profile.extensionCounts,
		largest_extension: profile.largestExtension,
		largest_extension_file_count: profile.largestExtensionFileCount,
		largest_extension_share: profile.largestExtensionShare,
		is_ephemeral_workspace: args.isEphemeralWorkspace,
	});
	if (profileResult?.status !== "queued") {
		return;
	}

	markWorkspaceProfiled(workspaceId);
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
	localStorage.setItem(workspaceProfileStorageKey(workspaceId), String(Date.now()));
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
	const extensions = Array.from(extensionCounts.entries())
		.map(([fileExtension, count]) => ({
			fileExtension,
			fileCount: count,
			share: fileCount === 0 ? 0 : count / fileCount,
		}))
		.sort((left, right) => {
			if (right.fileCount !== left.fileCount) {
				return right.fileCount - left.fileCount;
			}
			return left.fileExtension.localeCompare(right.fileExtension);
		})
		.map((extension, index) => ({
			...extension,
			rank: index + 1,
		}));
	const largest = extensions[0];

	return {
		fileCount,
		directoryCount: directories.size,
		extensionCount: extensions.length,
		extensionCounts: Object.fromEntries(
			extensions.map((extension) => [
				extension.fileExtension,
				extension.fileCount,
			]),
		),
		largestExtension: largest?.fileExtension,
		largestExtensionFileCount: largest?.fileCount,
		largestExtensionShare: largest?.share,
		extensions,
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
		return "none";
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
