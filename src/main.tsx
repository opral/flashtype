import {
	StrictMode,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { LixProvider } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { KeyValueProvider } from "./hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "./hooks/key-value/schema";
import { ErrorFallback } from "./main.error";
import { V2LayoutShell } from "./shell/layout-shell";
import { FirstRunScreen } from "./shell/first-run-screen";
import { WorkspaceLoadingScreen } from "./shell/workspace-loading-screen";
import { openDesktopLix } from "./lib/lix-client";
import { captureWorkspaceProfile } from "./lib/workspace-profile-telemetry";
import { MarkdownEditorFuzzHarness } from "./extensions/markdown/editor/markdown-editor-fuzz-harness";
import {
	activatePostHogRecording,
	syncPostHogWorkspaceContext,
} from "./lib/posthog-client";

type Workspace = Awaited<
	ReturnType<NonNullable<Window["flashtypeDesktop"]>["workspace"]["get"]>
>;
type WorkspaceRecovery = Awaited<
	ReturnType<
		NonNullable<Window["flashtypeDesktop"]>["workspace"]["getRecovery"]
	>
>;

/**
 * The workspace gates the app: without a folder, only the first-run screen
 * renders — no lix, no panels. Lix opens once a workspace exists.
 */
export const AppRoot = () => {
	// undefined = still asking the main process; null = first run.
	const [workspace, setWorkspace] = useState<Workspace | undefined>(undefined);
	const [workspaceRecovery, setWorkspaceRecovery] = useState<
		WorkspaceRecovery | null | undefined
	>(undefined);
	const [lix, setLix] = useState<Lix | null>(null);
	const [pendingOpenFilePaths, setPendingOpenFilePaths] = useState<string[]>(
		[],
	);
	const [pendingOpenFilesConsumed, setPendingOpenFilesConsumed] =
		useState(false);
	const [error, setError] = useState<unknown>(null);
	const [openingWorkspaceName, setOpeningWorkspaceName] = useState<
		string | null | undefined
	>(undefined);
	const [isUpdateReady, setIsUpdateReady] = useState(false);

	useEffect(() => {
		void activatePostHogRecording();
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const current =
					(await window.flashtypeDesktop?.workspace.get()) ?? null;
				const recovery = current
					? ((await window.flashtypeDesktop?.workspace.getRecovery()) ?? null)
					: null;
				if (!cancelled) {
					setWorkspaceRecovery(recovery);
					setWorkspace(current);
				}
			} catch (e) {
				if (!cancelled) setError(e);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		// The document title wins over Electron's window.setTitle, so the
		// workspace = window-title rule is enforced here.
		document.title = workspace ? workspace.name : "Flashtype";
	}, [workspace]);

	const openFolderInFlightRef = useRef(false);
	const handleInstallUpdate = useCallback(async () => {
		await window.flashtypeDesktop?.app?.installUpdate();
	}, []);

	useEffect(() => {
		const desktopApp = window.flashtypeDesktop?.app;
		if (!desktopApp) return;

		let cancelled = false;
		void desktopApp.getUpdateState().then((state) => {
			if (!cancelled) setIsUpdateReady(state.updateReady);
		});

		const unsubscribe = desktopApp.onUpdateState((state) => {
			setIsUpdateReady(state.updateReady);
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const handleOpenFolder = useCallback(
		async (path?: string) => {
			const desktop = window.flashtypeDesktop;
			if (!desktop || openFolderInFlightRef.current) return;
			openFolderInFlightRef.current = true;
			if (!workspace) {
				setOpeningWorkspaceName(path ? workspaceNameFromPath(path) : null);
			}
			let keepLoadingScreen = false;
			try {
				const openPayload = path ? { path } : undefined;
				const opened = await (workspace
					? desktop.workspace.openInNewWindow(openPayload)
					: desktop.workspace.open(openPayload));
				// null = picker canceled; keep the current state.
				if (!opened || opened.path === workspace?.path) return;
				if (workspace) return;
				setOpeningWorkspaceName(opened.name);
				setWorkspaceRecovery((await desktop.workspace.getRecovery?.()) ?? null);
				keepLoadingScreen = true;
				// When switching, close the running lix before the workspace state
				// flips: close() lags its IPC, so an unawaited close could race the
				// new open and kill the fresh instance.
				if (lix) {
					setLix(null);
					await lix.close();
				}
				setWorkspace(opened);
			} catch (error) {
				setOpeningWorkspaceName(undefined);
				setError(error);
			} finally {
				openFolderInFlightRef.current = false;
				if (!keepLoadingScreen) {
					setOpeningWorkspaceName(undefined);
				}
			}
		},
		[lix, workspace],
	);

	// ⌘O opens the directory picker everywhere — first run and open workspace.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const usesPrimaryModifier = event.metaKey || event.ctrlKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "o") return;
			event.preventDefault();
			void handleOpenFolder();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleOpenFolder]);

	useEffect(() => {
		if (!workspace || workspaceRecovery === undefined || workspaceRecovery) {
			return;
		}
		let cancelled = false;
		let current: Lix | undefined;
		(async () => {
			try {
				const instance = await openDesktopLix();
				if (cancelled) {
					await instance.close();
					return;
				}
				current = instance;
				setLix(instance);
			} catch (e) {
				const recovery =
					(await window.flashtypeDesktop?.workspace.getRecovery()) ?? null;
				if (!cancelled) {
					if (recovery) {
						setWorkspaceRecovery(recovery);
					} else {
						setError(e);
					}
				}
			}
		})();
		return () => {
			cancelled = true;
			setLix(null);
			void (async () => {
				if (current) await current.close();
			})();
		};
	}, [workspace, workspaceRecovery]);

	useEffect(() => {
		if (!workspace || !lix) return;
		setOpeningWorkspaceName(undefined);
		void syncPostHogWorkspaceContext(lix).catch((error: unknown) => {
			console.warn("Failed to sync PostHog workspace context", error);
		});
		void captureWorkspaceProfile({
			lix,
		}).catch((error: unknown) => {
			console.warn("Failed to capture workspace profile telemetry", error);
		});
	}, [lix, workspace]);

	useEffect(() => {
		setPendingOpenFilesConsumed(false);
		setPendingOpenFilePaths([]);
		if (!workspace || !lix) return;
		let cancelled = false;
		(async () => {
			try {
				const filePaths =
					(await window.flashtypeDesktop?.workspace.consumePendingOpenFiles()) ??
					[];
				if (!cancelled) {
					setPendingOpenFilePaths(filePaths);
					setPendingOpenFilesConsumed(true);
				}
			} catch (e) {
				if (!cancelled) setError(e);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [lix, workspace]);

	const handlePendingOpenFileHandled = useCallback((filePath: string) => {
		setPendingOpenFilePaths((current) =>
			current.filter((pendingFilePath) => pendingFilePath !== filePath),
		);
	}, []);

	if (workspaceRecovery) return <ErrorFallback recovery={workspaceRecovery} />;
	if (error) return <ErrorFallback error={error} />;
	if (workspace === undefined) return <BootPlaceholder />;
	if (workspaceRecovery === undefined) return <BootPlaceholder />;
	if (workspace === null) {
		if (openingWorkspaceName !== undefined) {
			return <WorkspaceLoadingScreen workspaceName={openingWorkspaceName} />;
		}
		return (
			<FirstRunScreen
				onOpenFolder={handleOpenFolder}
				isUpdateReady={isUpdateReady}
				onInstallUpdate={handleInstallUpdate}
			/>
		);
	}
	if (!lix) {
		return (
			<WorkspaceLoadingScreen
				workspaceName={openingWorkspaceName ?? workspace.name}
			/>
		);
	}

	return (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<Suspense fallback={<BootPlaceholder />}>
					<V2LayoutShell
						workspace={workspace}
						workspaceName={workspace.name}
						onOpenWorkspace={handleOpenFolder}
						pendingOpenFilePaths={pendingOpenFilePaths}
						canPersistOpenFileSession={
							pendingOpenFilesConsumed && pendingOpenFilePaths.length === 0
						}
						onPendingOpenFileHandled={handlePendingOpenFileHandled}
						onError={setError}
						isUpdateReady={isUpdateReady}
						onInstallUpdate={handleInstallUpdate}
					/>
				</Suspense>
			</KeyValueProvider>
		</LixProvider>
	);
};

function BootPlaceholder() {
	return <div className="h-dvh w-full bg-[var(--color-bg-app)]" />;
}

function workspaceNameFromPath(path: string): string | null {
	const name = path
		.replace(/[\\/]+$/u, "")
		.split(/[\\/]/u)
		.pop()
		?.trim();
	return name || null;
}

const root = createRoot(document.getElementById("root")!);
if (shouldRenderMarkdownEditorFuzzHarness()) {
	root.render(<MarkdownEditorFuzzHarness />);
} else {
	root.render(
		<StrictMode>
			<AppRoot />
		</StrictMode>,
	);
}

function shouldRenderMarkdownEditorFuzzHarness(): boolean {
	return (
		import.meta.env.DEV &&
		new URLSearchParams(window.location.search).get("e2e") ===
			"markdown-editor-fuzz"
	);
}
