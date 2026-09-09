import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AtelierSessionStateStore } from "@opral/atelier";
import { Share2, X, Copy, Globe, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

type ShareApi = NonNullable<Window["flashtypeDesktop"]>["share"];
type Status = Awaited<ReturnType<ShareApi["status"]>>;
const RESUME_KEY = "flashtype.share.resume";
export function ShareButton({
	store,
	workspace,
}: {
	store: AtelierSessionStateStore;
	workspace: { path: string; ephemeral?: boolean; name: string };
}) {
	const state = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	const panel = state?.panels.central;
	const active = panel?.views.find(
		(view) => view.instance === panel.activeInstance,
	);
	const activePath =
		typeof active?.state?.filePath === "string" ? active.state.filePath : null;
	const [resume] = useState<{ path: string; publish?: boolean } | null>(() => {
		try {
			const value = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
			return value?.workspace === workspace.path &&
				typeof value.path === "string"
				? value
				: null;
		} catch {
			return null;
		}
	});
	const [selection, setSelection] = useState<string | null>(
		resume?.path ?? null,
	);
	const [status, setStatus] = useState<Status>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const [token, setToken] = useState("");
	const dialog = useRef<HTMLDialogElement>(null);
	const api = window.flashtypeDesktop?.share;
	const started = useRef(false);
	useEffect(() => {
		if (!selection || !api) return;
		dialog.current?.showModal();
		let cancelled = false;
		setBusy(true);
		setError("");
		setCopied(false);
		void api
			.status(selection)
			.then(async (value) => {
				if (cancelled) return;
				setStatus(value);
				if (resume?.publish && !started.current) {
					started.current = true;
					sessionStorage.setItem(
						RESUME_KEY,
						JSON.stringify({ workspace: workspace.path, path: selection }),
					);
					if (!value.hasToken || !value.connected || value.error)
						throw new Error(
							value.error ??
								"Add an API token and reconnect to finish sharing.",
						);
					const publication = await api.publish(selection, true);
					if (!cancelled) setStatus({ ...value, ...publication });
				}
			})
			.catch((error) => {
				if (!cancelled)
					setError(
						error instanceof Error ? error.message : "Sharing is unavailable.",
					);
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [selection, api, resume]);
	const close = () => {
		if (busy) return;
		dialog.current?.close();
		sessionStorage.removeItem(RESUME_KEY);
		setToken("");
		setSelection(null);
		setStatus(undefined);
		setError("");
	};
	async function run(action: () => Promise<void>) {
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Sharing is unavailable.",
			);
		} finally {
			setBusy(false);
		}
	}
	function remember(publish = false) {
		sessionStorage.setItem(
			RESUME_KEY,
			JSON.stringify({ workspace: workspace.path, path: selection, publish }),
		);
	}
	async function publish() {
		if (!api || !selection) return;
		if (!status?.connected) {
			await api.connect(true);
			remember(true);
			await api.reconnect();
			return;
		}
		const publication = await api.publish(selection, true);
		setStatus({ ...status, ...publication });
	}
	return (
		<>
			<button
				type="button"
				className="flashtype-share-button"
				disabled={!activePath || !api}
				title={activePath ? "Share this file" : "Open a file to share it"}
				onClick={() => {
					setStatus(undefined);
					setSelection(activePath);
				}}
			>
				<Share2 size={14} />
				Share
			</button>
			<dialog
				ref={dialog}
				className="flashtype-share-dialog"
				onCancel={(event) => {
					event.preventDefault();
					close();
				}}
				onPointerDown={(event) => {
					if (event.target === event.currentTarget) close();
				}}
				aria-labelledby="share-title"
			>
				<div className="p-6">
					<div className="flex items-start justify-between gap-4">
						<div>
							<h2 id="share-title" className="text-lg font-semibold">
								Share file
							</h2>
							<p className="mt-1 break-all text-sm text-[var(--color-text-secondary)]">
								{selection?.slice(1)}
							</p>
						</div>
						<button
							type="button"
							aria-label="Close sharing"
							disabled={busy}
							onClick={close}
							className="rounded p-1"
						>
							<X size={18} />
						</button>
					</div>
					<div className="my-5 flex items-start gap-3 rounded-lg border border-[var(--color-border-subtle)] p-4">
						{status?.published ? (
							<Globe size={20} className="shrink-0" />
						) : (
							<LockKeyhole size={20} className="shrink-0" />
						)}
						<div className="text-sm leading-relaxed">
							<p className="font-semibold">
								{status?.published
									? "Anyone with the link can view"
									: "Publish this file on Lixray"}
							</p>
							<p className="mt-1 text-[var(--color-text-secondary)]">
								{status?.published
									? "Updates to this file appear at the same link after they sync."
									: `The whole ${workspace.name} repository, including its history, will sync privately to Lixray. Only this file will be published.`}
							</p>
						</div>
					</div>
					{workspace.ephemeral && (
						<p className="mb-4 text-sm">
							Initialize a repository to save history and enable sharing for
							this folder.
						</p>
					)}
					{(error || status?.error) && (
						<p role="alert" className="mb-4 text-sm text-red-600">
							{error || status?.error}
						</p>
					)}
					{status?.published && status.url && (
						<div className="mb-4 flex gap-2">
							<input
								aria-label="Published file link"
								className="min-w-0 flex-1 rounded border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
								readOnly
								value={status.url}
							/>
							<Button
								size="sm"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await navigator.clipboard.writeText(status.url!);
										setCopied(true);
									})
								}
							>
								<Copy />
								{copied ? "Copied" : "Copy link"}
							</Button>
						</div>
					)}
					{(!status?.hasToken || status.error) && !workspace.ephemeral && (
						<div className="mb-4 grid gap-2">
							<p className="text-sm">
								Create an API token in your{" "}
								<button
									type="button"
									className="underline"
									onClick={() =>
										void window.flashtypeDesktop!.app.openExternal({
											url: "https://lixray.com/settings",
										})
									}
								>
									Lixray account settings
								</button>
								, then paste it here.
							</p>
							<label htmlFor="lixray-api-token" className="text-sm">
								API token
							</label>
							<input
								id="lixray-api-token"
								type="password"
								autoComplete="off"
								value={token}
								onChange={(event) => setToken(event.target.value)}
								className="rounded border border-[var(--color-border-subtle)] px-3 py-2"
							/>
						</div>
					)}
					<div className="flex flex-wrap justify-end gap-2">
						{workspace.ephemeral ? (
							<Button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										remember();
										await window.flashtypeDesktop!.workspace.initializeRepository();
									})
								}
							>
								Initialize repository
							</Button>
						) : !status?.hasToken || status.error ? (
							<Button
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await api!.setToken(token);
										setToken("");
										const nextStatus = await api!.status(selection!);
										setStatus(nextStatus);
										if (nextStatus.connected) {
											remember();
											await api!.reconnect();
										}
									})
								}
							>
								{busy ? "Connecting…" : "Save token"}
							</Button>
						) : status.published ? (
							status.inherited ? (
								<p className="text-sm text-[var(--color-text-secondary)]">
									Published through its folder or repository. Manage access on
									Lixray.
								</p>
							) : (
								<Button
									variant="ghost"
									disabled={busy}
									onClick={() =>
										void run(async () => {
											setStatus({
												...status,
												...(await api!.publish(selection!, false)),
											});
											setCopied(false);
										})
									}
								>
									Unpublish file
								</Button>
							)
						) : (
							<Button disabled={busy} onClick={() => void run(publish)}>
								{busy
									? "Preparing share…"
									: status.connected
										? "Publish file"
										: "Sync privately and publish file"}
							</Button>
						)}
					</div>
				</div>
			</dialog>
		</>
	);
}
