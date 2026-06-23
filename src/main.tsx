import {
	StrictMode,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle } from "lucide-react";
import "./index.css";
import { LixProvider } from "@/lib/lix-react";
import type { Lix } from "@/lib/lix-types";
import { KeyValueProvider } from "./hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "./hooks/key-value/schema";
import { ErrorFallback } from "./main.error";
import { V2LayoutShell } from "./shell/layout-shell";
import { FirstRunScreen } from "./shell/first-run-screen";
import { openDesktopLix } from "./lib/lix-client";
import { captureTelemetry } from "./lib/telemetry";
import {
	captureWorkspaceProfile,
	readWorkspaceId,
} from "./lib/workspace-profile-telemetry";
import { capturePostHogWorkspaceActive } from "./lib/posthog-client";

type Workspace = Awaited<
	ReturnType<NonNullable<Window["flashtypeDesktop"]>["workspace"]["get"]>
>;

const WORKSPACE_ACTIVE_SIGNAL_THROTTLE_MS = 30 * 60 * 1000;
const WORKSPACE_TOO_LARGE_ERROR_CODE = "ERR_FLASHTYPE_WORKSPACE_TOO_LARGE";

/**
 * The workspace gates the app: without a folder, only the first-run screen
 * renders — no lix, no panels. Lix opens once a workspace exists.
 */
export const AppRoot = () => {
	// undefined = still asking the main process; null = first run.
	const [workspace, setWorkspace] = useState<Workspace | undefined>(undefined);
	const [lix, setLix] = useState<Lix | null>(null);
	const [pendingOpenFilePaths, setPendingOpenFilePaths] = useState<string[]>(
		[],
	);
	const [error, setError] = useState<unknown>(null);
	const [workspaceOpenWarning, setWorkspaceOpenWarning] = useState<
		string | null
	>(null);
	const [isUpdateReady, setIsUpdateReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const current =
					(await window.flashtypeDesktop?.workspace.get()) ?? null;
				if (!cancelled) setWorkspace(current);
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
	const lastWorkspaceActiveSignalRef = useRef(0);
	const workspaceIdRef = useRef<string | undefined>(undefined);
	const handleInstallUpdate = useCallback(async () => {
		captureTelemetry("update installed", { source: "renderer" });
		await window.flashtypeDesktop?.app?.installUpdate();
	}, []);

	useEffect(() => {
		workspaceIdRef.current = undefined;
	}, [workspace]);

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
			try {
				const openPayload = path ? { path } : undefined;
				const opened = await (workspace
					? desktop.workspace.openInNewWindow(openPayload)
					: desktop.workspace.open(openPayload));
				// null = picker canceled; keep the current state.
				if (!opened || opened.path === workspace?.path) return;
				if (workspace) return;
				// When switching, close the running lix before the workspace state
				// flips: close() lags its IPC, so an unawaited close could race the
				// new open and kill the fresh instance.
				if (lix) {
					setLix(null);
					await lix.close();
				}
				setWorkspace(opened);
			} catch (error) {
				if (isWorkspaceTooLargeError(error)) {
					setWorkspaceOpenWarning(formatWorkspaceOpenWarning(error));
					return;
				}
				setError(error);
			} finally {
				openFolderInFlightRef.current = false;
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
		if (!workspace) return;
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
				if (!cancelled) setError(e);
			}
		})();
		return () => {
			cancelled = true;
			setLix(null);
			void (async () => {
				if (current) await current.close();
			})();
		};
	}, [workspace]);

	const signalWorkspaceActive = useCallback(
		(reason: string) => {
			if (!workspace || !lix) return;
			const now = Date.now();
			if (
				reason !== "workspace_ready" &&
				now - lastWorkspaceActiveSignalRef.current <
					WORKSPACE_ACTIVE_SIGNAL_THROTTLE_MS
			) {
				return;
			}
			lastWorkspaceActiveSignalRef.current = now;
			void (async () => {
				const workspaceId =
					workspaceIdRef.current ?? (await readWorkspaceId(lix));
				workspaceIdRef.current = workspaceId;
				void capturePostHogWorkspaceActive({ reason, workspaceId }).catch(
					(error: unknown) => {
						console.warn("Failed to capture workspace active telemetry", error);
					},
				);
			})().catch((error: unknown) => {
				console.warn("Failed to capture workspace active telemetry", error);
			});
		},
		[lix, workspace],
	);

	useEffect(() => {
		signalWorkspaceActive("workspace_ready");
	}, [signalWorkspaceActive]);

	useEffect(() => {
		if (!workspace || !lix) return;
		void captureWorkspaceProfile({
			lix,
			isEphemeralWorkspace: workspace.ephemeral,
		}).catch((error: unknown) => {
			console.warn("Failed to capture workspace profile telemetry", error);
		});
	}, [lix, workspace]);

	useEffect(() => {
		if (!workspace || !lix) return;
		const handleFocus = () => signalWorkspaceActive("window_focused");
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				signalWorkspaceActive("document_visible");
			}
		};
		const handleInteraction = () => signalWorkspaceActive("user_interaction");

		window.addEventListener("focus", handleFocus);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("pointerdown", handleInteraction, {
			capture: true,
		});
		window.addEventListener("keydown", handleInteraction, { capture: true });
		return () => {
			window.removeEventListener("focus", handleFocus);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("pointerdown", handleInteraction, {
				capture: true,
			});
			window.removeEventListener("keydown", handleInteraction, {
				capture: true,
			});
		};
	}, [lix, signalWorkspaceActive, workspace]);

	useEffect(() => {
		if (!workspace || !lix) return;
		let cancelled = false;
		(async () => {
			try {
				const filePaths =
					(await window.flashtypeDesktop?.workspace.consumePendingOpenFiles()) ??
					[];
				if (!cancelled && filePaths.length > 0) {
					setPendingOpenFilePaths(filePaths);
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
	const closeWorkspaceOpenWarning = useCallback(() => {
		setWorkspaceOpenWarning(null);
	}, []);

	if (error) return <ErrorFallback error={error} />;
	if (workspace === undefined) return <BootPlaceholder />;
	if (workspace === null) {
		return (
			<>
				<WorkspaceOpenWarningDialog
					message={workspaceOpenWarning}
					onClose={closeWorkspaceOpenWarning}
				/>
				<FirstRunScreen
					onOpenFolder={handleOpenFolder}
					isUpdateReady={isUpdateReady}
					onInstallUpdate={handleInstallUpdate}
				/>
			</>
		);
	}
	if (!lix) return <BootPlaceholder />;

	return (
		<>
			<WorkspaceOpenWarningDialog
				message={workspaceOpenWarning}
				onClose={closeWorkspaceOpenWarning}
			/>
			<LixProvider lix={lix}>
				<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
					<Suspense fallback={<BootPlaceholder />}>
						<V2LayoutShell
							workspaceName={workspace.name}
							onOpenWorkspace={handleOpenFolder}
							pendingOpenFilePaths={pendingOpenFilePaths}
							onPendingOpenFileHandled={handlePendingOpenFileHandled}
							onError={setError}
							isUpdateReady={isUpdateReady}
							onInstallUpdate={handleInstallUpdate}
						/>
					</Suspense>
				</KeyValueProvider>
			</LixProvider>
		</>
	);
};

function BootPlaceholder() {
	return <div className="h-dvh w-full bg-[var(--color-bg-app)]" />;
}

function WorkspaceOpenWarningDialog({
	message,
	onClose,
}: {
	readonly message: string | null;
	readonly onClose: () => void;
}) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!message) return;
		closeButtonRef.current?.focus();
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [message, onClose]);

	if (!message) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<div
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="workspace-open-warning-title"
				aria-describedby="workspace-open-warning-description"
				className="w-full max-w-md rounded-lg border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-5 text-[var(--color-text-primary)] shadow-2xl"
			>
				<div className="flex items-start gap-3">
					<div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-notice-warning)] text-[var(--color-text-notice-warning)]">
						<AlertTriangle className="size-5" strokeWidth={2} />
					</div>
					<div className="min-w-0">
						<h1
							id="workspace-open-warning-title"
							className="text-base font-semibold leading-6"
						>
							Folder too large
						</h1>
						<p
							id="workspace-open-warning-description"
							className="mt-1 text-sm leading-5 text-[var(--color-text-secondary)]"
						>
							{message}
						</p>
					</div>
				</div>
				<div className="mt-5 flex justify-end">
					<button
						ref={closeButtonRef}
						type="button"
						className="inline-flex h-8 items-center justify-center rounded-md bg-[var(--color-bg-action-primary)] px-3 text-sm font-medium text-[var(--color-text-on-action-primary)] transition-colors hover:bg-[var(--color-bg-action-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
						onClick={onClose}
					>
						OK
					</button>
				</div>
			</div>
		</div>
	);
}

function isWorkspaceTooLargeError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const maybeError = error as { code?: unknown; message?: unknown };
	return (
		maybeError.code === WORKSPACE_TOO_LARGE_ERROR_CODE ||
		(typeof maybeError.message === "string" &&
			(maybeError.message.includes(WORKSPACE_TOO_LARGE_ERROR_CODE) ||
				maybeError.message.includes("too large for Flashtype to open")))
	);
}

function formatWorkspaceOpenWarning(error: unknown): string {
	if (
		error &&
		typeof error === "object" &&
		typeof (error as { message?: unknown }).message === "string"
	) {
		return stripIpcErrorPrefix((error as { message: string }).message);
	}
	return "This folder is too large for Flashtype to open. Please open a smaller folder.";
}

function stripIpcErrorPrefix(message: string): string {
	return message
		.replace(/^Error invoking remote method '[^']+':\s*/u, "")
		.replace(/^Error:\s*/u, "")
		.trim();
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppRoot />
	</StrictMode>,
);
