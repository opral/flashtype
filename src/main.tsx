import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { LixProvider } from "@lix-js/react-utils";
import type { Lix } from "@lix-js/sdk";
import { KeyValueProvider } from "./hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "./hooks/key-value/schema";
import { ErrorFallback } from "./main.error";
import { V2LayoutShell } from "./app/layout-shell";
import { openDesktopLix } from "./lib/lix-client";
import markdownPluginV2ArchiveUrl from "../lix/packages/plugin-md-v2/plugin-md-v2.lixplugin?url";

let markdownPluginV2ArchiveBytesPromise: Promise<Uint8Array> | undefined;

async function loadMarkdownPluginV2ArchiveBytes(): Promise<Uint8Array> {
	if (!markdownPluginV2ArchiveBytesPromise) {
		markdownPluginV2ArchiveBytesPromise = fetch(markdownPluginV2ArchiveUrl)
			.then((response) => {
				if (!response.ok) {
					throw new Error(
						`Failed to load markdown plugin archive asset: ${response.status}`,
					);
				}
				return response.arrayBuffer();
			})
			.then((buffer) => new Uint8Array(buffer));
	}
	return await markdownPluginV2ArchiveBytesPromise;
}

// Error UI moved to ./main.error.tsx

export const AppRoot = () => {
	const [lix, setLix] = useState<Lix | null>(null);
	const [error, setError] = useState<unknown>(null);

	useEffect(() => {
		let cancelled = false;
		let current: Lix | undefined;
		(async () => {
			try {
				const instance = await openDesktopLix();
				const markdownPluginV2ArchiveBytes =
					await loadMarkdownPluginV2ArchiveBytes();
				await instance.installPlugin({
					archiveBytes: markdownPluginV2ArchiveBytes,
				});
				if (cancelled) {
					await instance.close();
					return;
				}
				current = instance;
				if (!cancelled) setLix(instance);
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
	}, []);

	if (error) return <ErrorFallback error={error} />;
	if (!lix)
		return (
			<div className="min-h-dvh w-full flex items-center justify-center p-6 text-sm text-muted-foreground">
				Loading…
			</div>
		);

	return (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<Suspense
					fallback={
						<div className="min-h-dvh w-full flex items-center justify-center p-6 text-sm text-muted-foreground">
							Loading…
						</div>
					}
				>
					<V2LayoutShell />
				</Suspense>
			</KeyValueProvider>
		</LixProvider>
	);
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppRoot />
	</StrictMode>,
);
