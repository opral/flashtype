import { useEffect, useRef, useState } from "react";
import { TerminalSquare } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { createReactWidgetDefinition } from "../../widget-runtime/react-widget";
import { TERMINAL_WIDGET_KIND } from "../../widget-runtime/widget-instance-helpers";

const XTERM_THEMES = {
	light: {
		background: "#ffffff",
		foreground: "#111827",
		cursor: "#111827",
		selectionBackground: "#dbeafe",
	},
	dark: {
		background: "#0b1020",
		foreground: "#e5e7eb",
		cursor: "#e5e7eb",
		selectionBackground: "#334155",
	},
} as const;

function TerminalView({
	initialCommand,
}: {
	/** Typed into the shell once the session starts. */
	readonly initialCommand?: string;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const initialCommandRef = useRef(initialCommand);
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		if (typeof document === "undefined") {
			return "light";
		}
		return resolveThemeFromDocument(document.documentElement);
	});

	useEffect(() => {
		const root = document.documentElement;
		const updateTheme = () => {
			setTheme(resolveThemeFromDocument(root));
		};
		updateTheme();
		const observer = new MutationObserver(updateTheme);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ["class", "data-theme"],
		});
		return () => {
			observer.disconnect();
		};
	}, []);

	useEffect(() => {
		const desktop = window.flashtypeDesktop;
		const terminalApi = desktop?.terminal;
		const container = containerRef.current;

		if (!desktop?.lix || !terminalApi || !container) {
			return;
		}

		let disposed = false;
		let terminalId: string | null = null;

		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			lineHeight: 1.2,
			scrollback: 3000,
			allowTransparency: false,
			theme: XTERM_THEMES[resolveThemeFromDocument(document.documentElement)],
		});
		terminalRef.current = terminal;
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		fitAddon.fit();

		const handleResize = () => {
			if (disposed) return;
			fitAddon.fit();
			if (!terminalId) return;
			void terminalApi.resize({
				id: terminalId,
				cols: terminal.cols,
				rows: terminal.rows,
			});
		};

		const resizeObserver = new ResizeObserver(() => {
			handleResize();
		});
		resizeObserver.observe(container);

		const stopData = terminalApi.onData((event) => {
			if (event.id !== terminalId) return;
			terminal.write(event.data);
		});
		const stopExit = terminalApi.onExit((event) => {
			if (event.id !== terminalId) return;
			terminal.writeln("");
			terminal.writeln(
				`[process exited${event.exitCode !== null ? ` (${event.exitCode})` : ""}]`,
			);
		});

		const inputDisposable = terminal.onData((data) => {
			if (!terminalId) return;
			void terminalApi.write({ id: terminalId, data });
		});

		void (async () => {
			try {
				const cwd = await desktop.lix.workspaceDir();
				if (disposed) {
					return;
				}
				const created = await terminalApi.create({
					cwd,
					cols: terminal.cols,
					rows: terminal.rows,
				});
				if (disposed) {
					await terminalApi.kill({ id: created.id });
					return;
				}
				terminalId = created.id;
				handleResize();
				const command = initialCommandRef.current;
				initialCommandRef.current = undefined;
				if (command) {
					await terminalApi.write({ id: created.id, data: `${command}\r` });
				}
			} catch (error) {
				if (disposed) return;
				terminal.writeln("Failed to start terminal session.");
				terminal.writeln(String(error));
			}
		})();

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			stopData();
			stopExit();
			inputDisposable.dispose();
			if (terminalId) {
				void terminalApi.kill({ id: terminalId });
			}
			terminalRef.current = null;
			terminal.dispose();
		};
	}, []);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) {
			return;
		}
		terminal.options.theme = XTERM_THEMES[theme];
	}, [theme]);

	if (!window.flashtypeDesktop?.terminal) {
		return (
			<div className="flex h-full min-h-0 items-center justify-center px-4 text-sm text-neutral-600">
				Terminal is only available in the desktop app.
			</div>
		);
	}

	return (
		<div
			className="h-full min-h-0"
			style={{ backgroundColor: XTERM_THEMES[theme].background }}
		>
			<div ref={containerRef} className="h-full w-full p-2" />
		</div>
	);
}

export const widget = createReactWidgetDefinition({
	kind: TERMINAL_WIDGET_KIND,
	label: "Terminal",
	description: "Run shell commands in a native terminal session.",
	icon: TerminalSquare,
	multiInstance: true,
	component: ({ instance }) => (
		<TerminalView
			initialCommand={
				typeof instance.state?.command === "string"
					? instance.state.command
					: undefined
			}
		/>
	),
});

function resolveThemeFromDocument(root: HTMLElement): "light" | "dark" {
	if (root.dataset.theme === "dark" || root.classList.contains("dark")) {
		return "dark";
	}
	return "light";
}
