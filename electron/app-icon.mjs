import path from "node:path";

export const PRODUCTION_APP_ICON = "build/icon.png";
export const DEVELOPMENT_APP_ICON = "build/icon-dev.png";
export const DEVELOPMENT_DOCK_ICON = "build/icon-dev.icns";

export function shouldUseDevelopmentAppIcon({
	isDevRuntime,
	isPackaged,
	viteDevServerUrl,
} = {}) {
	return (
		isPackaged !== true &&
		isDevRuntime === true &&
		typeof viteDevServerUrl === "string"
	);
}

export function getApplicationIconPath(appPath, options = {}) {
	return path.join(
		appPath,
		shouldUseDevelopmentAppIcon(options)
			? DEVELOPMENT_APP_ICON
			: PRODUCTION_APP_ICON,
	);
}

export function getDevelopmentDockIconPath(appPath) {
	return path.join(appPath, DEVELOPMENT_DOCK_ICON);
}
