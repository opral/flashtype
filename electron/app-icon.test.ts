import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	DEVELOPMENT_APP_ICON,
	DEVELOPMENT_DOCK_ICON,
	getApplicationIconPath,
	getDevelopmentDockIconPath,
	PRODUCTION_APP_ICON,
	shouldUseDevelopmentAppIcon,
} from "./app-icon.mjs";

describe("application icon selection", () => {
	test("uses the production icon for packaged builds even with a dev server URL", () => {
		expect(
			shouldUseDevelopmentAppIcon({
				isDevRuntime: true,
				isPackaged: true,
				viteDevServerUrl: "http://127.0.0.1:4173",
			}),
		).toBe(false);

		expect(
			getApplicationIconPath("/app", {
				isDevRuntime: true,
				isPackaged: true,
				viteDevServerUrl: "http://127.0.0.1:4173",
			}),
		).toBe(path.join("/app", PRODUCTION_APP_ICON));
	});

	test("uses the production icon when no explicit dev server is present", () => {
		expect(
			shouldUseDevelopmentAppIcon({
				isDevRuntime: true,
				isPackaged: false,
				viteDevServerUrl: undefined,
			}),
		).toBe(false);

		expect(
			getApplicationIconPath("/app", {
				isDevRuntime: true,
				isPackaged: false,
				viteDevServerUrl: undefined,
			}),
		).toBe(path.join("/app", PRODUCTION_APP_ICON));
	});

	test("uses the production icon for unpackaged runs without the dev marker", () => {
		expect(
			shouldUseDevelopmentAppIcon({
				isDevRuntime: false,
				isPackaged: false,
				viteDevServerUrl: "http://127.0.0.1:4173",
			}),
		).toBe(false);

		expect(
			getApplicationIconPath("/app", {
				isDevRuntime: false,
				isPackaged: false,
				viteDevServerUrl: "http://127.0.0.1:4173",
			}),
		).toBe(path.join("/app", PRODUCTION_APP_ICON));
	});

	test("uses the development icon only for explicit unpackaged dev runs", () => {
		expect(
			shouldUseDevelopmentAppIcon({
				isDevRuntime: true,
				isPackaged: false,
				viteDevServerUrl: "http://127.0.0.1:4173",
			}),
		).toBe(true);

		expect(
			getApplicationIconPath("/app", {
				isDevRuntime: true,
				isPackaged: false,
				viteDevServerUrl: "http://127.0.0.1:4173",
			}),
		).toBe(path.join("/app", DEVELOPMENT_APP_ICON));
	});

	test("resolves the development Dock icon as an icns asset", () => {
		expect(getDevelopmentDockIconPath("/app")).toBe(
			path.join("/app", DEVELOPMENT_DOCK_ICON),
		);
	});
});
