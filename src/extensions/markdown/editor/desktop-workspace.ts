import { useEffect, useState } from "react";

type WorkspaceDirState = {
	readonly loaded: boolean;
	readonly workspaceDir: string | null;
};

export function useDesktopWorkspaceDir(): WorkspaceDirState {
	const [state, setState] = useState<WorkspaceDirState>(() => {
		const desktopLix = desktopLixApi();
		return desktopLix
			? { loaded: false, workspaceDir: null }
			: { loaded: true, workspaceDir: null };
	});

	useEffect(() => {
		const desktopLix = desktopLixApi();
		if (!desktopLix) {
			setState({ loaded: true, workspaceDir: null });
			return;
		}

		let cancelled = false;
		void desktopLix.workspaceDir().then(
			(workspaceDir) => {
				if (!cancelled) {
					setState({ loaded: true, workspaceDir });
				}
			},
			() => {
				if (!cancelled) {
					setState({ loaded: true, workspaceDir: null });
				}
			},
		);

		return () => {
			cancelled = true;
		};
	}, []);

	return state;
}

function desktopLixApi():
	| NonNullable<Window["flashtypeDesktop"]>["lix"]
	| undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	return window.flashtypeDesktop?.lix;
}

export function desktopWorkspaceApi():
	| NonNullable<Window["flashtypeDesktop"]>["workspace"]
	| undefined {
	if (typeof window === "undefined") {
		return undefined;
	}
	return window.flashtypeDesktop?.workspace;
}
