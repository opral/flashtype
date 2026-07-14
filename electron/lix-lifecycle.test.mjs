// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	acquireWorkspaceLocalFilesystemOptions: vi.fn(),
	storageOptions: [],
	getWorkspace: vi.fn(),
	nativeLixHandles: [],
	openLix: vi.fn(),
}));

vi.mock("electron", () => ({
	app: { getPath: () => "/tmp/flashtype-lix-lifecycle-user-data" },
}));

vi.mock("@lix-js/sdk", () => ({
	LocalFilesystem: class FakeLocalFilesystem {
		constructor(options) {
			mocks.storageOptions.push(options);
		}

		async importPaths() {}
		async syncDiskToLix() {}
	},
	bundledPluginArchives: async () => [],
	openLix: mocks.openLix,
}));

vi.mock("./workspace.mjs", () => ({
	acquireWorkspaceLocalFilesystemOptions:
		mocks.acquireWorkspaceLocalFilesystemOptions,
	getWorkspace: mocks.getWorkspace,
	getWorkspaceLixDatabasePath: () => "/workspace/.lix/.internal/db.sqlite",
}));

vi.mock("./workspace-recovery.mjs", () => ({
	clearWorkspaceLixOpenPendingSync: vi.fn(),
	markWorkspaceLixOpenPendingSync: vi.fn(),
	writeWorkspaceRecoverySync: vi.fn(),
}));

vi.mock("./telemetry.mjs", () => ({
	captureTelemetryException: vi.fn(),
}));

vi.mock("./workspace-recovery-telemetry.mjs", () => ({
	captureWorkspaceRecoveryLifecycle: vi.fn(),
}));

const { closeAllLixSessions, ensureLixOpen, runWithLixClosed } =
	await import("./lix.mjs");

describe("Lix workspace lifecycle", () => {
	afterEach(async () => {
		await closeAllLixSessions({ ignoreOpenError: true });
		mocks.acquireWorkspaceLocalFilesystemOptions.mockReset();
		mocks.storageOptions.length = 0;
		mocks.getWorkspace.mockReset();
		mocks.nativeLixHandles.length = 0;
		mocks.openLix.mockReset();
	});

	test("does not reopen Lix until an atomic workspace transition completes", async () => {
		const persistentOptions = {
			path: "/workspace",
			syncAllFiles: true,
		};
		const ephemeralOptions = {
			path: "/workspace",
			lixDir: "/tmp/external/.lix",
			syncAllFiles: false,
		};
		let currentOptions = persistentOptions;
		let currentWorkspace = {
			ephemeral: false,
			name: "workspace",
			path: "/workspace",
		};
		mocks.getWorkspace.mockImplementation(() => currentWorkspace);
		mocks.acquireWorkspaceLocalFilesystemOptions.mockImplementation(
			async () => ({
				options: currentOptions,
				release: async () => {},
			}),
		);
		mocks.openLix.mockImplementation(async () => {
			const nativeLix = {
				close: vi.fn(async () => {}),
			};
			mocks.nativeLixHandles.push(nativeLix);
			return nativeLix;
		});

		const window = createTestWindow();
		await ensureLixOpen(window);
		expect(mocks.openLix).toHaveBeenCalledTimes(1);

		const transitionEntered = deferred();
		const finishTransition = deferred();
		const transition = runWithLixClosed(window, async () => {
			currentWorkspace = {
				ephemeral: true,
				name: "workspace",
				openFilePaths: [],
				path: "/workspace",
			};
			currentOptions = ephemeralOptions;
			transitionEntered.resolve();
			await finishTransition.promise;
		});
		await transitionEntered.promise;

		const reopen = ensureLixOpen(window);
		await Promise.resolve();
		expect(mocks.openLix).toHaveBeenCalledTimes(1);

		finishTransition.resolve();
		await transition;
		await reopen;

		expect(mocks.openLix).toHaveBeenCalledTimes(2);
		expect(mocks.storageOptions).toEqual([persistentOptions, ephemeralOptions]);
	});
});

function createTestWindow() {
	return {
		id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
		isDestroyed: () => false,
		once: vi.fn(),
	};
}

function deferred() {
	let resolve;
	const promise = new Promise((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
