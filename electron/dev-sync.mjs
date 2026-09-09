import path from "node:path";

/** A development connection applies only to its explicitly selected workspace. */
export function getDevSyncServer(workspace, env = process.env) {
	if (env.FLASHTYPE_DEV_RUNTIME !== "1" || workspace.ephemeral === true)
		return undefined;
	if (!env.FLASHTYPE_DEV_SYNC_URL || !env.FLASHTYPE_DEV_SYNC_WORKSPACE)
		return undefined;
	if (
		path.resolve(workspace.path) !==
		path.resolve(env.FLASHTYPE_DEV_SYNC_WORKSPACE)
	)
		return undefined;
	return {
		url: env.FLASHTYPE_DEV_SYNC_URL,
		...(env.FLASHTYPE_DEV_SYNC_TOKEN
			? { headers: { Authorization: `Bearer ${env.FLASHTYPE_DEV_SYNC_TOKEN}` } }
			: {}),
	};
}
