import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@lix-js/sdk": path.resolve(__dirname, "src/test-utils/node-lix-sdk.ts"),
		},
	},
	test: {
		environment: "happy-dom",
		globals: true,
		setupFiles: ["setup-tests.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		// Each worker loads the native Lix/DataFusion/RocksDB addon. Running several
		// copies in parallel can exhaust the Linux CI runner while the Files suite
		// repeatedly opens real Lix instances.
		maxWorkers: process.env.CI ? 1 : undefined,
		exclude: [
			...configDefaults.exclude,
			"e2e/**",
			"submodule/**",
			".claude/**",
			"website/dist/**",
			"**/target/**",
		],
	},
});
