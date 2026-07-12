import { afterEach, describe, expect, test, vi } from "vitest";
import { openDesktopLix } from "./lix-client";

const originalDesktop = window.flashtypeDesktop;

afterEach(() => {
	window.flashtypeDesktop = originalDesktop;
	vi.restoreAllMocks();
});

describe("openDesktopLix syncDiskToLix", () => {
	test("restores tracked paths before syncing a filtered workspace", async () => {
		const desktop = createDesktop({
			workspace: {
				ephemeral: true,
				path: "/workspace",
				name: "workspace",
				openFilePaths: [],
			},
			trackedPaths: [
				"/notes/ideas.md",
				"/README.md",
				"/.lix/plugins/plugin_md_v2.lixplugin",
			],
		});
		window.flashtypeDesktop = desktop.api;

		const lix = await openDesktopLix();
		await lix.syncDiskToLix();

		expect(desktop.importFilesystemPaths).toHaveBeenCalledWith({
			paths: ["notes/ideas.md", "README.md"],
		});
		expect(desktop.syncDiskToLix).toHaveBeenCalledOnce();
		expect(desktop.order).toEqual(["paths", "import", "sync"]);
	});

	test("leaves an unfiltered persistent workspace on the direct sync path", async () => {
		const desktop = createDesktop({
			workspace: {
				ephemeral: false,
				path: "/workspace",
				name: "workspace",
			},
			trackedPaths: ["/notes/ideas.md"],
		});
		window.flashtypeDesktop = desktop.api;

		const lix = await openDesktopLix();
		await lix.syncDiskToLix();

		expect(desktop.execute).not.toHaveBeenCalled();
		expect(desktop.importFilesystemPaths).not.toHaveBeenCalled();
		expect(desktop.syncDiskToLix).toHaveBeenCalledOnce();
		expect(desktop.order).toEqual(["sync"]);
	});
});

function createDesktop(args: {
	readonly workspace:
		| { ephemeral: false; path: string; name: string }
		| {
				ephemeral: true;
				path: string;
				name: string;
				openFilePaths: string[];
		  };
	readonly trackedPaths: readonly string[];
}) {
	const order: string[] = [];
	const execute = vi.fn(async () => {
		order.push("paths");
		return {
			rows: args.trackedPaths.map((path) => [path]),
			columns: ["path"],
		};
	});
	const importFilesystemPaths = vi.fn(async () => {
		order.push("import");
	});
	const syncDiskToLix = vi.fn(async () => {
		order.push("sync");
	});
	const api = {
		lix: {
			open: vi.fn(async () => {}),
			execute,
			importFilesystemPaths,
			syncDiskToLix,
			close: vi.fn(async () => {}),
		},
		workspace: {
			get: vi.fn(async () => args.workspace),
		},
	} as unknown as NonNullable<Window["flashtypeDesktop"]>;
	return {
		api,
		execute,
		importFilesystemPaths,
		order,
		syncDiskToLix,
	};
}
