import type { JSX } from "react";
import { Zap } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import { TopBar } from "./top-bar";

export function WorkspaceLoadingScreen({
	workspaceName,
}: {
	readonly workspaceName?: string | null;
}): JSX.Element {
	const name = workspaceName?.trim();

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
			</main>
		</div>
	);
}
