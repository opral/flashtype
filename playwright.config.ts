import { defineConfig } from "@playwright/test";

const rendererPort = process.env.FLASHTYPE_E2E_RENDERER_PORT ?? "4174";
const rendererUrl = `http://127.0.0.1:${rendererPort}`;

export default defineConfig({
	testDir: "./e2e",
	testIgnore: ["**/packaged-macos.spec.ts"],
	fullyParallel: false,
	workers: 1,
	timeout: 180_000,
	expect: {
		timeout: 10_000,
	},
	reporter: "list",
	use: {
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
	webServer: {
		command: `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${rendererPort} --strictPort`,
		url: rendererUrl,
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
