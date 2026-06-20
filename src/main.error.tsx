import { useState } from "react";
import { RotateCcw, Bug, AlertTriangle, Trash2 } from "lucide-react";

function formatError(err: unknown): string {
	const asAny = err as any;
	try {
		if (!err) return "Unknown error";
		if (err instanceof Error) {
			let out = `${err.name || "Error"}: ${err.message || ""}`;
			if (err.stack) out += "\n" + String(err.stack);
			const cause = asAny?.cause;
			if (cause) out += "\nCaused by: " + formatError(cause);
			const errors = asAny?.errors;
			if (Array.isArray(errors)) {
				for (let i = 0; i < errors.length; i++) {
					out += `\nInner[${i}]: ` + formatError(errors[i]);
				}
			}
			return out;
		}
		return typeof err === "string" ? err : JSON.stringify(err, null, 2);
	} catch {
		return String(err);
	}
}

function containsOpfsHandleConflict(err: unknown): boolean {
	const visited = new Set<unknown>();

	function walk(node: unknown): boolean {
		if (!node || visited.has(node)) return false;
		visited.add(node);
		if (typeof node === "object") {
			const anyNode = node as any;
			const name = anyNode?.name;
			const message =
				typeof anyNode?.message === "string" ? anyNode.message : "";
			if (
				(name === "NoModificationAllowedError" ||
					message.includes("NoModificationAllowedError")) &&
				message.includes("createSyncAccessHandle")
			) {
				return true;
			}
			if (walk(anyNode?.cause)) return true;
			const errors = anyNode?.errors;
			if (Array.isArray(errors)) {
				for (const inner of errors) {
					if (walk(inner)) return true;
				}
			}
		}
		return false;
	}

	return walk(err);
}

/**
 * Minimal error UI shown when Lix fails to load.
 */
export function ErrorFallback(props: { error: unknown }) {
	const [busyAction, setBusyAction] = useState<"reset" | null>(null);
	const [resetError, setResetError] = useState<unknown>(null);
	const busy = busyAction !== null;

	async function handleReset() {
		if (busy) return;
		setBusyAction("reset");
		setResetError(null);
		try {
			const resetRepository =
				window.flashtypeDesktop?.workspace?.resetLixRepository;
			if (typeof resetRepository !== "function") {
				throw new Error(
					"Reset Lix repository is only available in the desktop app.",
				);
			}
			await resetRepository();
			window.location.reload();
		} catch (error) {
			setResetError(error);
			setBusyAction(null);
		}
	}

	if (containsOpfsHandleConflict(props.error)) {
		return (
			<div className="min-h-dvh w-full flex items-center justify-center p-6">
				<div className="max-w-lg w-full border rounded-lg p-6 bg-card text-card-foreground">
					<div className="flex items-center gap-2 text-[var(--color-text-notice-warning)] mb-3">
						<AlertTriangle className="h-5 w-5" />
						<h1 className="text-lg font-semibold">Flashtype is already open</h1>
					</div>
					<p className="text-sm text-muted-foreground mb-4">
						Flashtype can only be open in one tab at a time. Close other tabs
						where Flashtype is running, then reload this page. If the issue
						persists, please report a bug.
					</p>
					<div className="flex items-center gap-3">
						<button
							onClick={() => window.location.reload()}
							className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<RotateCcw className="h-4 w-4" /> Reload this tab
						</button>
						<a
							href="https://github.com/opral/flashtype/issues"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<Bug className="h-4 w-4" /> Report bug
						</a>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-dvh w-full overflow-auto p-6">
			<div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-4xl items-center">
				<div className="min-w-0 w-full border rounded-lg p-6 bg-card text-card-foreground">
					<h1 className="text-xl font-semibold mb-2">
						Flashtype failed to start
					</h1>
					<p className="text-sm text-muted-foreground mb-4">
						Lix could not be loaded. This can happen if the lix schema was
						changed in development. If this is unexpected, please contact the
						developer.
					</p>
					<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 mb-4">
						<p className="text-sm font-medium text-destructive">
							Reset the Lix repository to rebuild it from this workspace.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<button
							onClick={handleReset}
							disabled={busy}
							className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-[var(--color-text-on-action-primary)] text-sm disabled:opacity-60"
						>
							<Trash2 className="h-4 w-4" />
							{busyAction === "reset" ? "Resetting..." : "Reset Lix repository"}
						</button>
						<button
							onClick={() => window.location.reload()}
							className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<RotateCcw className="h-4 w-4" /> Reload app
						</button>
						<a
							href="https://github.com/opral/flashtype/issues"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<Bug className="h-4 w-4" /> Report bug
						</a>
					</div>
					{resetError ? (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
							<div className="font-medium mb-2">Reset failed</div>
							<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
								{formatError(resetError)}
							</pre>
						</div>
					) : null}
					<div className="mt-4 max-h-[50dvh] overflow-auto text-xs opacity-80 border rounded p-3 bg-muted/20">
						<div className="font-medium mb-2">Error details</div>
						<pre className="whitespace-pre-wrap break-words font-mono leading-relaxed">
							{formatError(props.error)}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
