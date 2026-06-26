import { useState } from "react";
import { RotateCcw, Bug, AlertTriangle, Trash2 } from "lucide-react";

type WorkspaceRecovery = Awaited<
	ReturnType<
		NonNullable<Window["flashtypeDesktop"]>["workspace"]["getRecovery"]
	>
>;

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
export function ErrorFallback(props: {
	readonly error?: unknown;
	readonly recovery?: WorkspaceRecovery | null;
}) {
	const [busyAction, setBusyAction] = useState<"disable" | "try-again" | null>(
		null,
	);
	const [actionError, setActionError] = useState<unknown>(null);
	const busy = busyAction !== null;
	const recovery = props.recovery ?? null;

	async function handleDisableTrackChanges() {
		if (busy) return;
		setBusyAction("disable");
		setActionError(null);
		try {
			const disableTrackChanges =
				window.flashtypeDesktop?.workspace?.disableTrackChanges;
			if (typeof disableTrackChanges !== "function") {
				throw new Error(
					"Disabling Track Changes is only available in the desktop app.",
				);
			}
			await disableTrackChanges();
			window.location.reload();
		} catch (error) {
			setActionError(error);
			setBusyAction(null);
		}
	}

	async function handleTryAgain() {
		if (busy) return;
		setBusyAction("try-again");
		setActionError(null);
		try {
			await window.flashtypeDesktop?.workspace?.clearRecovery();
			window.location.reload();
		} catch (error) {
			setActionError(error);
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

	const details = recovery ?? props.error;

	return (
		<div className="min-h-dvh w-full overflow-auto p-6">
			<div className="mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-4xl items-center">
				<div className="min-w-0 w-full border rounded-lg p-6 bg-card text-card-foreground">
					<h1 className="text-xl font-semibold mb-2">
						Track Changes could not be opened
					</h1>
					<p className="text-sm text-muted-foreground mb-4">
						Flashtype had trouble opening change tracking for
						{recovery?.workspaceName
							? ` ${recovery.workspaceName}`
							: " this workspace"}
						. You can disable Track Changes to remove the workspace .lix data
						and open the folder normally. Your project files will not be
						deleted.
					</p>
					<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 mb-4">
						<p className="text-sm font-medium text-destructive">
							Disabling Track Changes removes change history stored in .lix.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<button
							onClick={handleDisableTrackChanges}
							disabled={busy}
							className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-[var(--color-text-on-action-primary)] text-sm disabled:opacity-60"
						>
							<Trash2 className="h-4 w-4" />
							{busyAction === "disable"
								? "Disabling..."
								: "Disable Track Changes"}
						</button>
						<button
							onClick={
								recovery ? handleTryAgain : () => window.location.reload()
							}
							disabled={busy}
							className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
						>
							<RotateCcw className="h-4 w-4" />
							{busyAction === "try-again" ? "Trying..." : "Try again"}
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
					{actionError ? (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
							<div className="font-medium mb-2">Action failed</div>
							<pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
								{formatError(actionError)}
							</pre>
						</div>
					) : null}
					<div className="mt-4 max-h-[50dvh] overflow-auto text-xs opacity-80 border rounded p-3 bg-muted/20">
						<div className="font-medium mb-2">Error details</div>
						<pre className="whitespace-pre-wrap break-words font-mono leading-relaxed">
							{formatError(details)}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
