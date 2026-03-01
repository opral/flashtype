import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const markdownPluginV2ArchivePath = resolve(
	process.cwd(),
	"submodule/lix/packages/plugin-md-v2/plugin-md-v2.lixplugin",
);

export const markdownPluginV2ArchiveBytes = new Uint8Array(
	readFileSync(markdownPluginV2ArchivePath),
);
