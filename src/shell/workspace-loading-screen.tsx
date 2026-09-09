import { useEffect, useState, type JSX } from "react";
import { Zap } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { TopBar } from "./top-bar";

export function WorkspaceLoadingScreen({
	workspaceName,
	workspacePath,
}: {
	readonly workspaceName?: string | null;
	readonly workspacePath?: string;
}): JSX.Element {
	const name = workspaceName?.trim();
	const [timedOut, setTimedOut] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		setTimedOut(false);
		setBusy(false);
		setError(null);
		const timer = setTimeout(() => setTimedOut(true), 30_000);
		return () => clearTimeout(timer);
	}, [workspacePath, workspaceName]);
	async function deleteAndRestart() {
		if (!workspacePath || busy) return;
		setBusy(true);
		setError(null);
		try {
			const recover = window.flashtypeDesktop?.workspace?.deleteLixAndRestart;
			if (!recover)
				throw new Error("Restart Flashtype to load the recovery action.");
			await recover(workspacePath);
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error));
			setBusy(false);
		}
	}

	return (
		<div className="flex h-dvh flex-col bg-[var(--color-bg-app)] text-[var(--color-text-primary)]">
			<TopBar
				workspaceName={name || null}
				menu={
					<span className="flex h-7 w-7 items-center justify-center rounded-[7px]">
						<Zap className="size-3.75 fill-[var(--color-icon-brand)] text-[var(--color-icon-brand)]" />
					</span>
				}
			/>
			<main className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-9 text-center">
				<AnimatedZap size={96} label="Flashtype loading" tone="brand" />
				<h1 className="mt-6 text-[18px] font-bold tracking-normal text-[var(--color-text-primary)]">
					{name ? `Opening ${name}` : "Opening folder"}
				</h1>
				<p className="mt-2 max-w-72 text-[13px] leading-relaxed text-[var(--color-text-secondary)] text-pretty">
					Teaching the zap where the files live.
				</p>
				{timedOut && workspacePath ? (
					<section
						className="mt-6 max-w-md rounded-xl border border-[var(--color-border)] p-5"
						aria-label="Opening recovery"
					>
						<p className="font-semibold">
							Opening is taking longer than expected
						</p>
						<p className="mt-2 text-sm text-[var(--color-text-secondary)]">
							You can keep waiting, or delete this folder’s .lix and restart
							Flashtype. This permanently removes its change history. Your files
							will not be deleted. All Flashtype windows will restart.
						</p>
						<button
							type="button"
							disabled={busy}
							onClick={() => void deleteAndRestart()}
							className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							{busy ? "Restarting…" : "Delete .lix and restart"}
						</button>
						{error ? (
							<p role="alert" className="mt-3 text-sm text-red-700">
								{error}
							</p>
						) : null}
					</section>
				) : null}
			</main>
		</div>
	);
}
