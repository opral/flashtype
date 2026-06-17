import type { RenderableDiff } from "@/extension-runtime/types";

export function Diff(props: {
	diffs: RenderableDiff[];
	className?: string;
	contentClassName?: string;
}) {
	if (!props.diffs.length) {
		return null;
	}

	return (
		<div className={props.className}>
			<div className={props.contentClassName}>
				{props.diffs.map((diff) => (
					<section
						key={`${diff.entity_id}:${diff.schema_key}`}
						className="rounded border border-border p-3 mb-3"
					>
						<header className="mb-2 text-xs text-muted-foreground">
							{diff.status} • {diff.schema_key} • {diff.entity_id}
						</header>
						<div className="grid gap-3 md:grid-cols-2">
							<pre className="overflow-auto rounded bg-muted p-2 text-xs">
								{JSON.stringify(diff.before_snapshot_content, null, 2)}
							</pre>
							<pre className="overflow-auto rounded bg-muted p-2 text-xs">
								{JSON.stringify(diff.after_snapshot_content, null, 2)}
							</pre>
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
