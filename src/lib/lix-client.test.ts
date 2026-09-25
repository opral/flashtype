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

	test("exposes desktop observations as standard async iterators", async () => {
		const desktop = createDesktop({
			workspace: {
				ephemeral: false,
				path: "/workspace",
				name: "workspace",
			},
			trackedPaths: [],
		});
		desktop.observeNext
			.mockResolvedValueOnce({
				sequence: 1,
				mutationSequence: 2,
				result: {
					columns: ["value"],
					rows: [["snapshot"]],
					rowsAffected: 0,
					notices: [],
					commit: null,
				},
			})
			.mockResolvedValueOnce(undefined);
		window.flashtypeDesktop = desktop.api;

		const lix = await openDesktopLix();
		const events = lix.observe("SELECT 'snapshot' AS value");
		const observed = [];
		for await (const event of events) observed.push(event);

		expect(observed).toHaveLength(1);
		expect(observed[0]?.result.rows).toEqual([{ value: "snapshot" }]);
		expect(desktop.observeStart).toHaveBeenCalledOnce();
		expect(desktop.observeClose).toHaveBeenCalledOnce();
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
	const observeStart = vi.fn(async () => "observe-1");
	const observeNext = vi.fn(async (): Promise<{
		sequence: number;
		mutationSequence: number;
		result: {
			columns: string[];
			rows: unknown[][];
			rowsAffected: number;
			notices: never[];
			commit: null;
		};
	} | undefined> => undefined);
	const observeClose = vi.fn(async () => {});
	const api = {
		lix: {
			open: vi.fn(async () => ({ sessionId: "desktop-session" })),
			execute,
			importFilesystemPaths,
			syncDiskToLix,
			close: vi.fn(async () => {}),
			observeStart,
			observeNext,
			observeClose,
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
		observeStart,
		observeNext,
		observeClose,
	};
}
