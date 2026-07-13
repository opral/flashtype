import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
	Atelier,
	createAtelier,
	type AtelierInstance,
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
import { createFlashTypeAtelierExtensions } from "./extensions/atelier-host-extensions";
import {
	createAgentPromptTelemetryHandler,
	createAtelierTelemetryHandler,
} from "./lib/atelier-telemetry";
import { createAgentTurnReviewHandler } from "./lib/agent-turn-review-bridge";
import { connectAtelierWorkspace } from "./lib/atelier-workspace-bridge";

type Workspace = Awaited<
	ReturnType<NonNullable<Window["flashtypeDesktop"]>["workspace"]["get"]>
>;
type WorkspaceRecovery = Awaited<
	ReturnType<
		NonNullable<Window["flashtypeDesktop"]>["workspace"]["getRecovery"]
	>
>;

const DEFAULT_OPEN_ATELIER_PANELS = ["right"] as const;

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
	const [connectedAtelier, setConnectedAtelier] =
		useState<AtelierInstance | null>(null);
	const atelierExtensions = useMemo(
		() =>
			workspace
				? createFlashTypeAtelierExtensions(workspace)
				: ([] as readonly AtelierExtensionRegistration[]),
		[workspace],
	);
	const handleAtelierEvent = useMemo(
		() => (lix ? createAtelierTelemetryHandler(lix) : undefined),
		[lix],
	);
	const atelier = useMemo(
		() =>
			lix
				? createAtelier({
						// FlashType's renderer-side Lix proxy implements Atelier's runtime
						// contract but intentionally hides native SDK internals.
						lix: lix as unknown as AtelierInstance["lix"],
						extensions: atelierExtensions,
						filesViewMode: "sidebar",
						defaultOpenPanels: DEFAULT_OPEN_ATELIER_PANELS,
						onEvent: handleAtelierEvent,
					})
				: null,
		[lix, atelierExtensions, handleAtelierEvent],
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
		if (!atelier || !lix || !desktopWorkspace) return;
		let cancelled = false;
		const connection = connectAtelierWorkspace({
			documents: atelier.documents,
			lix,
			workspace: desktopWorkspace,
			onError: setError,
		});
		void connection.ready.then(() => {
			if (!cancelled) setConnectedAtelier(atelier);
		});
		return () => {
			cancelled = true;
			connection.dispose();
		};
	}, [atelier, lix]);

	useEffect(() => {
		if (!lix || !atelier) return;
		const handlePromptTelemetry = createAgentPromptTelemetryHandler(lix);
		const handleAgentTurnReview = createAgentTurnReviewHandler(atelier, {
			fileCapture: window.flashtypeDesktop?.workspace,
		});
		const unsubscribe = window.flashtypeDesktop?.agentHooks?.onTurnEvent(
			(event) => {
				handlePromptTelemetry(event);
				return handleAgentTurnReview(event);
			},
		);
		return () => unsubscribe?.();
	}, [atelier, lix]);

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
	if (!lix || !atelier) {
		return (
			<WorkspaceLoadingScreen
				workspaceName={openingWorkspaceName ?? workspace.name}
			/>
		);
	}

	return (
		<Suspense fallback={<BootPlaceholder />}>
			<div className="relative h-dvh">
				<Atelier
					instance={atelier}
					slots={{
						navbarStart: isMacDesktop ? (
							<span
								aria-hidden="true"
								className="flashtype-traffic-light-spacer"
							/>
						) : null,
						navbarEnd: isUpdateReady ? (
							<button
								type="button"
								className="flashtype-update-button"
								onClick={() => void handleInstallUpdate()}
							>
								Update
							</button>
						) : null,
						rightPanelEmpty: ({ openExtension }) => (
							<AgentInvite
								onStartClaude={() => openExtension("flashtype_claude")}
								onStartCodex={() => openExtension("flashtype_codex")}
							/>
						),
					}}
				/>
				{connectedAtelier !== atelier ? (
					<div className="absolute inset-0 z-50">
						<WorkspaceLoadingScreen workspaceName={workspace.name} />
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
const MarkdownEditorFuzzHarness = import.meta.env.DEV
	? lazy(async () => {
			const module =
				await import("./extensions/markdown/editor/markdown-editor-fuzz-harness");
			return { default: module.MarkdownEditorFuzzHarness };
		})
	: null;

if (shouldRenderMarkdownEditorFuzzHarness() && MarkdownEditorFuzzHarness) {
	root.render(
		<Suspense fallback={<BootPlaceholder />}>
			<MarkdownEditorFuzzHarness />
		</Suspense>,
	);
} else {
	// Atelier hosts extensions through imperative nested React roots. Rendering
	// the desktop shell in StrictMode would synchronously simulate teardown of
	// those roots (and the shared Lix connection) during development startup.
	// Use the same lifecycle as the packaged Electron app; editor components keep
	// dedicated StrictMode coverage in their tests.
	root.render(<AppRoot />);
}

function shouldRenderMarkdownEditorFuzzHarness(): boolean {
	return (
		import.meta.env.DEV &&
		new URLSearchParams(window.location.search).get("e2e") ===
			"markdown-editor-fuzz"
	);
}
