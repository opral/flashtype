// Pure state machine coordinating the renderer-mediated window close guard.
//
// Electron's `close` event fires on the main process, but only the renderer
// knows whether a Markdown review holds partial decisions. This guard lets the
// main process:
//   1. prevent the first close and ask the renderer,
//   2. ignore the re-entrant close events that arrive while asking,
//   3. allow the close once the renderer reports the user chose to leave
//      (using a per-window bypass flag so the re-issued close is not
//      intercepted recursively), and
//   4. keep a cancelled close open.
//
// It holds no Electron references so it can be unit-tested in isolation.

export function createWindowCloseGuard() {
	const asking = new Set();
	const bypass = new Set();
	// App-quit coordination. A quit must not start irreversible teardown until
	// every window's review guard has agreed to close, so the quit runs in three
	// phases: "idle" -> "confirming" (asking each window) -> "confirmed". A
	// cancelled confirmation returns to "idle" with no teardown, keeping the app
	// fully functional.
	let quitPhase = "idle";

	return {
		/**
		 * Handle a window `close` request.
		 * @returns {{ allow: boolean, ask: boolean }}
		 *   `allow` — let the OS close proceed now.
		 *   `ask` — the caller should query the renderer for a decision.
		 */
		handleCloseRequest(windowId) {
			if (bypass.has(windowId)) {
				bypass.delete(windowId);
				return { allow: true, ask: false };
			}
			if (asking.has(windowId)) {
				// A re-entrant close while we are still awaiting the user's choice.
				return { allow: false, ask: false };
			}
			asking.add(windowId);
			return { allow: false, ask: true };
		},

		/**
		 * Apply the renderer's decision for a pending close.
		 * @param {"allow" | "cancel"} decision
		 * @returns {{ closeNow: boolean }} whether to re-issue the window close.
		 */
		resolveDecision(windowId, decision) {
			if (!asking.has(windowId)) {
				return { closeNow: false };
			}
			asking.delete(windowId);
			if (decision === "allow") {
				bypass.add(windowId);
				return { closeNow: true };
			}
			return { closeNow: false };
		},

		/** Forget all state for a window (call on `closed`). */
		forget(windowId) {
			asking.delete(windowId);
			bypass.delete(windowId);
		},

		isAsking(windowId) {
			return asking.has(windowId);
		},
		isBypassing(windowId) {
			return bypass.has(windowId);
		},

		/**
		 * Begin (or observe) an app-quit confirmation.
		 * @returns {{ proceed: boolean, alreadyConfirming: boolean }}
		 *   `proceed` — the quit is already confirmed; let teardown run now.
		 *   `alreadyConfirming` — a confirmation is already in flight; do nothing.
		 */
		beginQuitConfirmation() {
			if (quitPhase === "confirmed") {
				return { proceed: true, alreadyConfirming: false };
			}
			if (quitPhase === "confirming") {
				return { proceed: false, alreadyConfirming: true };
			}
			quitPhase = "confirming";
			return { proceed: false, alreadyConfirming: false };
		},

		/** Mark the quit confirmed: every window agreed to close. */
		confirmQuit() {
			quitPhase = "confirmed";
		},

		/** Abort an in-flight confirmation (a window kept reviewing). */
		cancelQuit() {
			quitPhase = "idle";
		},

		isQuitConfirmed() {
			return quitPhase === "confirmed";
		},
		isConfirmingQuit() {
			return quitPhase === "confirming";
		},
	};
}
