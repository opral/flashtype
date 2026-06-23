import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig({
	base: "./",
	build: {
		sourcemap: true,
	},
	plugins: [
		react({
			babel: {
				plugins: ["babel-plugin-react-compiler"],
			},
		}),
		tailwindcss(),
		wasm(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"@markdown-wc/wasm": path.resolve(
				__dirname,
				"submodule/markdown-wc/js/pkg/markdown_wc_js_bindings.js",
			),
		},
	},
});
