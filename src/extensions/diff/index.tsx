import { Suspense, useMemo } from "react";
import type { ReactNode } from "react";
import { LixProvider, useQuery } from "@/lib/lix-react";
import { rawLixQuery } from "@/lib/lix-kysely";
import type { Lix } from "@/lib/lix-types";
import { Diff as DiffIcon, Loader2 } from "lucide-react";
import { Diff } from "@/components/diff";
import "../markdown/style.css";
import type {
	DiffExtensionConfig,
	RenderableDiff,
} from "../../extension-runtime/types";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { DIFF_EXTENSION_KIND } from "../../extension-runtime/extension-instance-helpers";

interface DiffViewProps {
	readonly config?: DiffExtensionConfig;
}

export function DiffView({ config }: DiffViewProps) {
	return (
		<Suspense fallback={<DiffLoadingSpinner />}>
			<DiffViewContent config={config} />
		</Suspense>
	);
}

function DiffViewContent({ config }: DiffViewProps) {
	const queryFactory = useMemo<(lix: Lix) => any>(() => {
		if (!config?.query) {
			return (lix: Lix) => emptyDiffQuery(lix);
		}
		const query = config.query;
		return (lix: Lix) => query(lix);
	}, [config]);

	const rawDiffs = useQuery(queryFactory) as RenderableDiff[];

	const diffs = useMemo<RenderableDiff[]>(() => {
		if (!Array.isArray(rawDiffs) || rawDiffs.length === 0) return [];
		return rawDiffs.map((diff) => ({
			...diff,
			before_snapshot_content: normalizeSnapshot(diff.before_snapshot_content),
			after_snapshot_content: normalizeSnapshot(diff.after_snapshot_content),
		}));
	}, [rawDiffs]);

	let content: ReactNode;
	if (!config?.query) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Diff view is unavailable for this tab.
			</div>
		);
	} else if (diffs.length === 0) {
		content = (
			<div className="text-sm text-muted-foreground">
				No differences detected for this source.
			</div>
		);
	} else {
		content = (
			<Diff
				diffs={diffs}
				className="markdown-view h-full"
				contentClassName="ProseMirror"
			/>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col px-2 py-2">
			<div className="flex-1 overflow-auto px-1">{content}</div>
		</div>
	);
}

function emptyDiffQuery(lix: Lix) {
	return rawLixQuery<RenderableDiff>(
		lix,
		"SELECT CAST(NULL AS TEXT) AS entity_id, CAST(NULL AS TEXT) AS schema_key, CAST(NULL AS TEXT) AS status, NULL AS before_snapshot_content, NULL AS after_snapshot_content WHERE false",
	);
}

function normalizeSnapshot(snapshot: unknown): Record<string, any> | null {
	if (snapshot === null || snapshot === undefined) return null;
	if (typeof snapshot === "string") {
		try {
			const parsed = JSON.parse(snapshot);
			return isRecord(parsed) ? parsed : null;
		} catch (error) {
			console.warn("Failed to parse snapshot content", error);
			return null;
		}
	}
	if (typeof Uint8Array !== "undefined" && snapshot instanceof Uint8Array) {
		try {
			const parsed = JSON.parse(new TextDecoder().decode(snapshot));
			return isRecord(parsed) ? parsed : null;
		} catch (error) {
			console.warn("Failed to decode snapshot content", error);
			return null;
		}
	}
	if (isRecord(snapshot)) {
		return snapshot;
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null;
}

function DiffLoadingSpinner(): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				<span>Loading diff…</span>
			</div>
		</div>
	);
}

/**
 * Diff inspection view definition used by the registry.
 *
 * @example
 * import { extension as diffView } from "@/extensions/diff-view";
 */
export const extension = createReactExtensionDefinition({
	kind: DIFF_EXTENSION_KIND,
	label: "Diff",
	description: "Inspect changes for a file.",
	icon: DiffIcon,
	component: ({ context, instance }) => (
		<LixProvider lix={context.lix}>
			<DiffView
				config={instance.state?.diff as DiffExtensionConfig | undefined}
			/>
		</LixProvider>
	),
});
