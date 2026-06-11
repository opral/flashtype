import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
	process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativePath = path.resolve(
	__dirname,
	"../submodule/lix/packages/js-sdk/lix_js_sdk.node",
);

await access(nativePath);
await run("install_name_tool", ["-id", "@rpath/lix_js_sdk.node", nativePath]);

function run(cmd, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${cmd} exited with code ${code ?? 1}`));
		});
	});
}
