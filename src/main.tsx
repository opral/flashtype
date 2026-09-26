import {
	createMemorySessionStateStore,
	type AtelierSessionUiState,
} from "@opral/atelier/state-adapters";
import { ShareButton } from "./shell/share-button";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
	Atelier,
	type AtelierLocation,
	type AtelierProps,
	type AtelierExtensionRegistration,
} from "@opral/atelier";
import "@opral/atelier/style.css";
import "./index.css";
import type { Lix } from "@/lib/lix-types";
import { ErrorFallback } from "./main.error";
import { FirstRunScreen } from "./shell/first-run-screen";
import { AgentInvite } from "./shell/agent-invite";
import { WorkspaceLoadingScreen } from "./shell/workspace-loading-screen";
import { openDesktopLix } from "./lib/lix-client";
import { captureWorkspaceProfile } from "./lib/workspace-profile-telemetry";
import {
	activatePostHogRecording,
	syncPostHogWorkspaceContext,
} from "./lib/posthog-client";
import { agentDiffBridge } from "./extensions/terminal/host-extensions";
import { createFlashTypeAtelierExtensions } from "./extensions/atelier-host-extensions";
import { createEphemeralFilesViewOptions } from "./lib/atelier-files-view";
import {
	createAgentPromptTelemetryHandler,
	createAtelierTelemetryHandler,
} from "./lib/atelier-telemetry";
import { createAgentTurnReviewHandler } from "./lib/agent-turn-review-bridge";
import { createDesktopDocumentCommands } from "./lib/atelier-desktop-commands";
import { connectAtelierWorkspace } from "./lib/atelier-workspace-bridge";

type Workspace = Awaited<
	ReturnType<NonNullable<Window["flashtypeDesktop"]>["workspace"]["get"]>
>;
type WorkspaceRecovery = Awaited<
	ReturnType<
		NonNullable<Window["flashtypeDesktop"]>["workspace"]["getRecovery"]
	>
>;

declare global {
	interface Window {
		__flashtypeE2E?: {
			getAtelierSessionState: () => AtelierSessionUiState | null;
		};
	}
}

const DEFAULT_OPEN_ATELIER_PANELS = ["left", "right"] as const;
const DOCUMENT_OPEN_ATELIER_PANELS = [] as const;

/**
 * The workspace gates the app: without a folder, only the first-run screen
 * renders — no lix, no panels. Lix opens once a workspace exists.
 */
export const AppRoot = () => {
	const isMacDesktop = window.flashtypeDesktop?.platform === "darwin";
	// undefined = still asking the main process; null = first run.
	const [workspace, setWorkspace] = useState<Workspace | undefined>(undefined);
	const [workspaceRecovery, setWorkspaceRecovery] = useState<
		WorkspaceRecovery | null | undefined
	>(undefined);
	const [lix, setLix] = useState<Lix | null>(null);
	const [error, setError] = useState<unknown>(null);
	const [openingWorkspaceName, setOpeningWorkspaceName] = useState<
		string | null | undefined
	>(undefined);
	const [isUpdateReady, setIsUpdateReady] = useState(false);
	const [location, setLocation] = useState<AtelierLocation | undefined>();
	const [connectedLix, setConnectedLix] = useState<Lix | null>(null);
	const atelierExtensions = useMemo(
		() =>
			workspace
				? createFlashTypeAtelierExtensions({
						temporaryHistory: workspace.ephemeral === true,
					})
				: ([] as readonly AtelierExtensionRegistration[]),
		[workspace],
	);
	// Transient workspaces surface un-imported disk files through atelier's
	// bundled Files view; persistent workspaces import everything up front.
	const atelierFilesView = useMemo(
		() =>
			lix && workspace?.ephemeral === true
				? createEphemeralFilesViewOptions(lix)
				: undefined,
		[lix, workspace?.ephemeral],
	);
	const handleAtelierEvent = useMemo(
		() => (lix ? createAtelierTelemetryHandler(lix) : undefined),
		[lix],
	);
	const defaultOpenAtelierPanels =
		workspace?.initialPanelMode === "document"
			? DOCUMENT_OPEN_ATELIER_PANELS
			: DEFAULT_OPEN_ATELIER_PANELS;
	const atelierSession = useMemo(
		() => ({ lix, store: createMemorySessionStateStore({
			focusedArea: "main",
			areas: {
				left: { views: [{ instance: "files-default", kind: "atelier_files" }], activeInstance: "files-default" },
				main: { views: [], activeInstance: null },
				right: { views: [{ instance: "agents-default", kind: "flashtype_agents" }], activeInstance: "agents-default" },
			},
		}) }),
		[lix],
	);
	const atelierSessionStateStore = atelierSession.store;
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		const e2e = {
			getAtelierSessionState: () => atelierSessionStateStore.getSnapshot(),
		};
		window.__flashtypeE2E = e2e;
		return () => {
			if (window.__flashtypeE2E === e2e) {
				delete window.__flashtypeE2E;
			}
		};
	}, [atelierSessionStateStore]);
	const documents = useMemo(
		() =>
			lix
				? createDesktopDocumentCommands({
						lix,
						store: atelierSessionStateStore,
						navigate: setLocation,
					})
				: null,
		[lix, atelierSessionStateStore],
	);

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
		const desktopWorkspace = window.flashtypeDesktop?.workspace;
		if (!documents || !lix || !desktopWorkspace) return;
		let cancelled = false;
		const connection = connectAtelierWorkspace({
			documents,
			lix,
			sessionStateStore: atelierSessionStateStore,
			workspace: desktopWorkspace,
			onError: setError,
		});
		void connection.ready.then(() => {
			if (!cancelled) setConnectedLix(lix);
		});
		return () => {
			cancelled = true;
			connection.dispose();
		};
	}, [documents, atelierSessionStateStore, lix]);

	useEffect(() => {
		if (!lix) return;
		const handlePromptTelemetry = createAgentPromptTelemetryHandler(lix);
		const handleAgentTurnReview = createAgentTurnReviewHandler(
			{ lix, diff: agentDiffBridge },
			{
				fileCapture: window.flashtypeDesktop?.workspace,
				getUiState: () => atelierSessionStateStore.getSnapshot(),
			},
		);
		const unsubscribe = window.flashtypeDesktop?.agentHooks?.onTurnEvent(
			(event) => {
				handlePromptTelemetry(event);
				return handleAgentTurnReview(event);
			},
		);
		return () => unsubscribe?.();
	}, [lix, atelierSessionStateStore]);

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
				workspacePath={workspace.ephemeral ? undefined : workspace.path}
			/>
		);
	}

	return (
		<Suspense fallback={<BootPlaceholder />}>
			<div className="relative h-dvh">
				<Atelier
					location={location}
					lix={lix as unknown as AtelierProps["lix"]}
					extensions={atelierExtensions}
					filesView={atelierFilesView}
					defaultOpenPanels={defaultOpenAtelierPanels}
					sessionStateStore={atelierSessionStateStore}
					onEvent={handleAtelierEvent}
					onError={setError}
					slots={{
						navbarStart: isMacDesktop ? (
							<span
								aria-hidden="true"
								className="flashtype-traffic-light-spacer"
							/>
						) : null,
						navbarEnd: (
							<div className="flex items-center gap-2">
								<ShareButton />
								{isUpdateReady ? (
									<button
										type="button"
										className="flashtype-update-button"
										onClick={() => void handleInstallUpdate()}
									>
										Update
									</button>
								) : null}
							</div>
						),
						rightPanelEmpty: ({ openExtension }) => (
							<AgentInvite
								onStartClaude={() => openExtension("flashtype_claude")}
								onStartCodex={() => openExtension("flashtype_codex")}
							/>
						),
					}}
				/>
				{connectedLix !== lix ? (
					<div className="absolute inset-0 z-50">
						<WorkspaceLoadingScreen
							workspaceName={workspace.name}
							workspacePath={workspace.ephemeral ? undefined : workspace.path}
						/>
					</div>
				) : null}
			</div>
		</Suspense>
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
// Atelier owns the editor implementation and its isolated fuzz tests. The
// desktop end-to-end fuzz suite exercises the same AppRoot users run.
root.render(<AppRoot />);
