import { useCallback, useEffect, useState } from "react";

type RepositorySize = {
	fileCount: number;
	totalBytes: number;
	complete: boolean;
	allowed: boolean;
};

function formatBytes(bytes: number) {
	if (bytes >= 1_000_000_000)
		return `${Math.ceil(bytes / 10_000_000) / 100} GB`;
	if (bytes >= 1_000_000) return `${Math.ceil(bytes / 10_000) / 100} MB`;
	if (bytes >= 1_000) return `${Math.ceil(bytes / 10) / 100} kB`;
	return `${bytes} B`;
}

export function TemporaryHistoryNotice() {
	const [pending, setPending] = useState(false);
	const [checking, setChecking] = useState(true);
	const [size, setSize] = useState<RepositorySize | null>(null);
	const [error, setError] = useState<string | null>(null);
	const check = useCallback(async () => {
		setChecking(true);
		setError(null);
		try {
			const workspace = window.flashtypeDesktop?.workspace;
			if (!workspace?.inspectRepositorySize)
				throw new Error(
					"Open or restart Flashtype on desktop to check this folder.",
				);
			setSize(await workspace.inspectRepositorySize());
		} catch (error) {
			setSize(null);
			setError(
				error instanceof Error &&
					(error.message.includes("restart Flashtype") ||
						error.message.includes("No handler registered"))
					? "Restart Flashtype to enable folder size checks."
					: "Could not check this folder. Make sure it is accessible, then check again.",
			);
		} finally {
			setChecking(false);
		}
	}, []);
	useEffect(() => {
		void check();
	}, [check]);

	async function initialize() {
		if (pending || checking || !size?.allowed) return;
		setPending(true);
		setError(null);
		try {
			const workspace = window.flashtypeDesktop?.workspace;
			if (!workspace)
				throw new Error(
					"Open Flashtype on desktop to initialize a repository.",
				);
			await workspace.initializeRepository();
		} catch (error) {
			await check();
			setError(
				error instanceof Error
					? error.message
					: "Could not initialize the repository. Try again.",
			);
			setPending(false);
		}
	}
	return (
		<div className="mx-2 mb-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-app)] p-3">
			<p className="text-xs font-semibold text-[var(--color-text-primary)]">
				Keep history after you close
			</p>
			<p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
				History is temporary. Initialize a repository to save future history in
				this folder. Your files are already saved.
			</p>
			<p className="mt-2 text-xs text-[var(--color-text-secondary)]">
				Supports up to 1 GB total, with no file-count limit. Includes
				subfolders. Git and Lix metadata are excluded.
			</p>
			<p
				role="status"
				className="mt-1 text-xs text-[var(--color-text-secondary)]"
			>
				{checking
					? "Checking folder…"
					: size
						? `${size.complete ? "" : "At least "}${size.fileCount} files · ${formatBytes(size.totalBytes)}${size.complete ? "" : " scanned"}`
						: "Folder size unavailable"}
			</p>
			{!checking && size && !size.allowed ? (
				<p
					role="alert"
					className="mt-2 text-xs text-[var(--color-text-primary)]"
				>
					This folder exceeds the repository limit. Open a smaller folder to
					keep persistent history. You can continue editing here.
				</p>
			) : null}
			<button
				type="button"
				disabled={pending || checking || !size?.allowed}
				onClick={() => void initialize()}
				className="mt-2.5 rounded-md bg-[var(--color-bg-action-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-on-action-primary)] hover:bg-[var(--color-bg-action-primary-hover)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
			>
				{pending ? "Initializing…" : "Initialize repository"}
			</button>
			<button
				type="button"
				onClick={() => void check()}
				disabled={checking || pending}
				className="ml-2 text-xs text-[var(--color-text-secondary)] underline disabled:opacity-60"
			>
				Check again
			</button>
			{error ? (
				<p role="alert" className="mt-2 text-xs text-red-600">
					{error}
				</p>
			) : null}
		</div>
	);
}
