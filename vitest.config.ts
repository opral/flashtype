import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import wasm from "vite-plugin-wasm";

export default defineConfig({
	plugins: [wasm()],
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@lix-js/sdk": path.resolve(__dirname, "src/test-utils/node-lix-sdk.ts"),
			"@markdown-wc/wasm": path.resolve(
				__dirname,
				"vendor/markdown-wc/js/pkg/markdown_wc_js_bindings.js",
			),
		},
	},
	test: {
		environment: "happy-dom",
		globals: true,
		setupFiles: ["setup-tests.ts"],
		testTimeout: 60_000,
		hookTimeout: 60_000,
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
