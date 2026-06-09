import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
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
		command: "pnpm run dev:renderer",
		url: "http://127.0.0.1:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
