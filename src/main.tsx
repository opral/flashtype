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
import { openDesktopLix } from "./lib/lix-client";

type Workspace = Awaited<
	ReturnType<NonNullable<Window["flashtypeDesktop"]>["workspace"]["get"]>
>;

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

	if (error) return <ErrorFallback error={error} />;
	if (workspace === undefined) return <BootPlaceholder />;
	if (workspace === null)
		return (
			<FirstRunScreen
				onOpenFolder={handleOpenFolder}
				isUpdateReady={isUpdateReady}
				onInstallUpdate={handleInstallUpdate}
			/>
		);
	if (!lix) return <BootPlaceholder />;

	return (
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
	);
};

function BootPlaceholder() {
	return <div className="h-dvh w-full bg-[var(--color-bg-app)]" />;
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppRoot />
	</StrictMode>,
);
