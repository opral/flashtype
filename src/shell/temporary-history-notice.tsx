import { useState } from "react";

export function TemporaryHistoryNotice() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function initialize() {
		if (pending) return;
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
			<button
				type="button"
				disabled={pending}
				onClick={() => void initialize()}
				className="mt-2.5 rounded-md bg-[var(--color-bg-action-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-on-action-primary)] hover:bg-[var(--color-bg-action-primary-hover)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
			>
				{pending ? "Initializing…" : "Initialize repository"}
			</button>
			{error ? (
				<p role="alert" className="mt-2 text-xs text-red-600">
					{error}
				</p>
			) : null}
		</div>
	);
}
