import clsx from "clsx";
import {
	forwardRef,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ComponentType,
	type CSSProperties,
	type HTMLAttributes,
	type MouseEvent,
	type ReactNode,
} from "react";
import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";
import { AGENT_LAUNCH_PRESETS, TAB_INSTANCE_ICONS } from "./agent-icons";
import { TERMINAL_WIDGET_KIND } from "../widget-runtime/widget-instance-helpers";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
	PanelSide,
	PanelState,
	WidgetContext,
	WidgetDefinition,
	WidgetInstance,
	WidgetKind,
	WidgetState,
} from "../widget-runtime/types";
import { useWidgetRegistry } from "../widget-runtime/widget-registry";
import styles from "./panel.module.css";

/** Lucide icons and image-based brand icons both fit this shape. */
type TabIcon = ComponentType<{ className?: string }>;
import { useWidgetContext } from "../widget-runtime/widget-context";
import {
	useWidgetHostRegistry,
	type WidgetHostRecord,
} from "../widget-runtime/widget-host-registry";
import { Activity } from "react";

/**
 * Unified panel host that renders the shared tab strip and body layout for any side.
 *
 * Pass callbacks and slots for customizing tabs, interaction behavior, and empty
 * placeholders so parents only supply their unique behavior.
 *
 * @example
 * <PanelV2
 *   side="left"
 *   panel={panelState}
 *   onSelectWidget={selectView}
 *   onRemoveWidget={removeView}
 *   emptyStatePlaceholder={<EmptyState />}
 *   extraTabBarContent={<AddViewButton />}
 * />
 */
export function PanelV2({
	side,
	panel,
	isFocused,
	onFocusPanel,
	onSelectWidget,
	onRemoveWidget,
	onAddView,
	viewContext,
	tabLabel,
	emptyStatePlaceholder,
	onActiveViewInteraction,
	dropId,
	viewOverrides,
	showTabBar = true,
}: PanelV2Props) {
	const { widgetMap } = useWidgetRegistry();
	const { setNodeRef, isOver } = useDroppable({
		id: dropId ?? `${side}-panel`,
		data: { panel: side },
	});

	const activeEntry = panel.activeInstance
		? (panel.views.find((entry) => entry.instance === panel.activeInstance) ??
			null)
		: (panel.views[0] ?? null);

	const resolveViewDefinition = useCallback(
		(kind: WidgetKind): WidgetDefinition | null => {
			const override = viewOverrides?.find(
				(candidate) => candidate.kind === kind,
			);
			return override ?? widgetMap.get(kind) ?? null;
		},
		[viewOverrides, widgetMap],
	);

	const hasViews = panel.views.length > 0;
	const activeInstance = activeEntry?.instance ?? null;
	const { badgeCounts, makeContext } = useWidgetContext({
		panel,
		isFocused,
		parentContext: viewContext,
	});

	const viewContexts = useMemo(() => {
		const map = new Map<string, ReturnType<typeof makeContext>>();
		for (const entry of panel.views) {
			map.set(entry.instance, makeContext(entry));
		}
		return map;
	}, [panel.views, makeContext]);

	const activationCleanupRef = useRef<Map<string, (() => void) | undefined>>(
		new Map(),
	);

	useEffect(() => {
		const cleanupMap = activationCleanupRef.current;
		for (const entry of panel.views) {
			if (cleanupMap.has(entry.instance)) continue;
			const view = resolveViewDefinition(entry.kind);
			if (!view?.activate) {
				cleanupMap.set(entry.instance, undefined);
				continue;
			}
			const contextForView = viewContexts.get(entry.instance);
			if (!contextForView) {
				cleanupMap.set(entry.instance, undefined);
				continue;
			}
			const cleanup = view.activate({
				context: contextForView,
				instance: entry,
			});
			cleanupMap.set(entry.instance, cleanup ?? undefined);
		}

		for (const [key, cleanup] of Array.from(cleanupMap.entries())) {
			if (!panel.views.some((entry) => entry.instance === key)) {
				cleanup?.();
				cleanupMap.delete(key);
			}
		}
	}, [panel.views, resolveViewDefinition, viewContexts]);

	useEffect(() => {
		const cleanupMap = activationCleanupRef.current;
		return () => {
			cleanupMap.forEach((cleanup) => cleanup?.());
			cleanupMap.clear();
		};
	}, []);

	const handleInteraction = () => {
		if (!onActiveViewInteraction || !activeInstance) return;
		onActiveViewInteraction(activeInstance);
	};

	const ContainerElement =
		side === "central" ? ("section" as const) : ("aside" as const);
	const hostTextClass =
		side === "central" ? "text-neutral-900" : "text-neutral-600";

	const contentHandlers =
		onActiveViewInteraction && activeInstance
			? {
					onPointerDownCapture: handleInteraction,
					onFocusCapture: handleInteraction,
				}
			: undefined;

	return (
		<ContainerElement
			ref={setNodeRef}
			onClickCapture={() => onFocusPanel(side)}
			className={clsx("flex h-full w-full flex-col", hostTextClass)}
		>
			<div
				className={clsx(
					"flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-island-border bg-neutral-0",
					isOver && "ring-2 ring-brand-600 ring-inset",
				)}
			>
				{/* Most islands render the identical 40px tab row; the central
				    editor hides it and switches files from the left file list. */}
				{showTabBar ? (
					<TabBar
						extraContent={
							onAddView ? (
								<AddViewMenu side={side} panel={panel} onAddView={onAddView} />
							) : null
						}
					>
						<SortableContext
							id={`panel-${side}`}
							items={panel.views.map((entry) => entry.instance)}
							strategy={horizontalListSortingStrategy}
						>
							{panel.views.map((entry) => {
								const view = resolveViewDefinition(entry.kind);
								if (!view) return null;
								const isActive = activeInstance === entry.instance;
								const label = resolveLabel(view, entry, tabLabel);
								const badgeCount = badgeCounts[entry.instance] ?? null;
								return (
									<SortableTab
										key={entry.instance}
										instance={entry.instance}
										panelSide={side}
										kind={entry.kind}
										icon={resolveTabIcon(entry) ?? view.icon}
										label={label}
										badgeCount={badgeCount}
										isActive={isActive}
										isFocused={isFocused && isActive}
										isPending={entry.isPending}
										onClick={() => onSelectWidget(entry.instance)}
										onClose={() => onRemoveWidget(entry.instance)}
									/>
								);
							})}
						</SortableContext>
					</TabBar>
				) : null}

				{hasViews ? (
					<PanelContent {...contentHandlers}>
						{panel.views.map((entry) => {
							const view = resolveViewDefinition(entry.kind);
							if (!view) return null;
							const context = viewContexts.get(entry.instance);
							if (!context) return null;
							const isActive = activeInstance === entry.instance;
							return (
								<Activity
									key={entry.instance}
									mode={isActive ? "visible" : "hidden"}
								>
									<ViewRenderer
										view={view}
										instance={entry}
										context={context}
										isActive={isActive}
									/>
								</Activity>
							);
						})}
					</PanelContent>
				) : (
					<PanelContent>{emptyStatePlaceholder}</PanelContent>
				)}
			</div>
		</ContainerElement>
	);
}

export type PanelV2Props = {
	readonly side: PanelSide;
	readonly panel: PanelState;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly onSelectWidget: (instance: string) => void;
	readonly onRemoveWidget: (instance: string) => void;
	/** Enables the "+" add-view menu in the tab row. */
	readonly onAddView?: (kind: WidgetKind, state?: WidgetState) => void;
	readonly viewContext: WidgetContext;
	readonly tabLabel?: (
		view: WidgetDefinition,
		instance: WidgetInstance,
	) => string;
	readonly emptyStatePlaceholder?: ReactNode;
	readonly onActiveViewInteraction?: (instance: string) => void;
	readonly dropId?: string;
	readonly viewOverrides?: WidgetDefinition[];
	/** Hide the tab strip (central editor switches files from the file list). */
	readonly showTabBar?: boolean;
};

/**
 * The "+" button in every island's tab row: agent sessions first (each click
 * opens a fresh session), then views not already open in this panel.
 */
function AddViewMenu({
	side,
	panel,
	onAddView,
}: {
	readonly side: PanelSide;
	readonly panel: PanelState;
	readonly onAddView: (kind: WidgetKind, state?: WidgetState) => void;
}) {
	const { visibleWidgets, widgetMap } = useWidgetRegistry();
	const openKinds = useMemo(
		() => new Set(panel.views.map((entry) => entry.kind)),
		[panel.views],
	);
	const availableViews = useMemo(
		() =>
			visibleWidgets.filter(
				(view) => view.multiInstance || !openKinds.has(view.kind),
			),
		[visibleWidgets, openKinds],
	);
	const hasTerminal = widgetMap.has(TERMINAL_WIDGET_KIND);
	if (availableViews.length === 0 && !hasTerminal) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					title="Add view"
					aria-label="Add view"
					className="flex size-6 flex-none items-center justify-center rounded-md text-ink-faint hover:bg-hover-soft hover:text-neutral-600"
				>
					<Plus className="size-3.25" strokeWidth={2} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={side === "right" ? "end" : "start"}
				className="w-44 border border-island-border bg-neutral-0 p-1 shadow-lg"
			>
				{hasTerminal ? (
					<>
						{AGENT_LAUNCH_PRESETS.map((preset) => (
							<DropdownMenuItem
								key={preset.key}
								onSelect={() => onAddView(TERMINAL_WIDGET_KIND, preset.state)}
								className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 focus:bg-hover-soft"
							>
								<preset.icon className="size-4" />
								<span>{preset.label}</span>
							</DropdownMenuItem>
						))}
						<DropdownMenuSeparator />
					</>
				) : null}
				{availableViews.map((ext) => (
					<DropdownMenuItem
						key={ext.kind}
						onSelect={() => onAddView(ext.kind)}
						className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-900 focus:bg-hover-soft"
					>
						<ext.icon className="h-4 w-4" />
						<span>{ext.label}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const resolveLabel = (
	view: WidgetDefinition,
	instance: WidgetInstance,
	tabLabel?: PanelV2Props["tabLabel"],
): string => {
	if (tabLabel) {
		return tabLabel(view, instance);
	}
	return (instance.state?.flashtype?.label as string | undefined) ?? view.label;
};

/** Per-instance icon override, e.g. the Claude mark on an agent terminal. */
const resolveTabIcon = (instance: WidgetInstance): TabIcon | null => {
	const key = instance.state?.flashtype?.icon as string | undefined;
	return (key && TAB_INSTANCE_ICONS[key]) || null;
};

interface TabBarProps {
	readonly children: ReactNode;
	readonly extraContent?: ReactNode;
}

function TabBar({ children, extraContent }: TabBarProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [thumb, setThumb] = useState({ width: "0%", left: "0%" });
	const [thumbVisible, setThumbVisible] = useState(false);
	const hideTimeoutRef = useRef<number | null>(null);

	const updateThumb = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const { scrollWidth, clientWidth, scrollLeft } = el;
		if (scrollWidth <= clientWidth) {
			setThumb({ width: "0%", left: "0%" });
			setThumbVisible(false);
			return;
		}
		const ratio = clientWidth / scrollWidth;
		const widthPercent = Math.max(ratio * 100, 10);
		const maxLeft = 100 - widthPercent;
		const leftPercent = Math.min(
			maxLeft,
			(scrollLeft / (scrollWidth - clientWidth)) * maxLeft,
		);
		setThumb({ width: `${widthPercent}%`, left: `${leftPercent}%` });
		setThumbVisible(true);
		if (hideTimeoutRef.current !== null) {
			window.clearTimeout(hideTimeoutRef.current);
		}
		hideTimeoutRef.current = window.setTimeout(
			() => setThumbVisible(false),
			250,
		);
	}, []);

	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		updateThumb();
		el.addEventListener("scroll", updateThumb);
		let resizeObserver: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(updateThumb);
			resizeObserver.observe(el);
		}
		return () => {
			el.removeEventListener("scroll", updateThumb);
			resizeObserver?.disconnect();
			if (hideTimeoutRef.current !== null) {
				window.clearTimeout(hideTimeoutRef.current);
				hideTimeoutRef.current = null;
			}
		};
	}, [updateThumb]);

	return (
		<div className={styles.tabBar}>
			<div className={styles.indicatorTrack}>
				<div
					className={styles.indicatorThumb}
					style={{
						...thumb,
						opacity: thumbVisible ? 1 : 0,
						transition: "width 0.12s ease, left 0.12s ease, opacity 0.18s ease",
					}}
				/>
			</div>
			<div ref={scrollRef} className={styles.scrollContainer}>
				{children}
				{extraContent}
			</div>
		</div>
	);
}

interface PanelContentProps extends HTMLAttributes<HTMLDivElement> {
	readonly children: ReactNode;
}

function PanelContent({
	children,
	className = "",
	...rest
}: PanelContentProps) {
	return (
		<div
			className={clsx(
				"flex min-h-0 flex-1 flex-col overflow-hidden",
				className,
			)}
			{...rest}
		>
			{children}
		</div>
	);
}

function ViewRenderer({
	view,
	instance,
	context,
	isActive,
}: {
	view: WidgetDefinition;
	instance: WidgetInstance;
	context: WidgetContext;
	isActive: boolean;
}) {
	const registry = useWidgetHostRegistry();
	const [host, setHost] = useState<WidgetHostRecord | null>(null);

	useEffect(() => {
		const record = registry.ensureHost({ view, instance, context });
		setHost(record);
	}, [registry, view, instance, context]);

	return (
		<ViewHostMount
			host={host}
			instance={instance.instance}
			kind={instance.kind}
			isActive={isActive}
		/>
	);
}

function ViewHostMount({
	host,
	instance,
	kind,
	isActive,
}: {
	host: WidgetHostRecord | null;
	instance: string;
	kind: WidgetKind;
	isActive: boolean;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);

	useLayoutEffect(() => {
		const mountPoint = containerRef.current;
		if (!mountPoint || !host) return;
		const node = host.container;
		mountPoint.appendChild(node);
		return () => {
			if (node.parentElement === mountPoint) {
				mountPoint.removeChild(node);
			}
		};
	}, [host]);

	return (
		<div
			ref={containerRef}
			data-view-instance={instance}
			data-view-key={kind}
			data-active={isActive ? "true" : undefined}
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
		/>
	);
}

interface SortableTabProps extends PanelTabPreviewProps {
	readonly instance: string;
	readonly panelSide: PanelSide;
	readonly kind: WidgetKind;
	readonly onClick?: () => void;
	readonly onClose?: () => void;
	readonly isPending?: boolean;
}

function SortableTab({
	instance,
	panelSide,
	kind,
	icon,
	label,
	badgeCount,
	isActive,
	isFocused,
	isPending,
	onClick,
	onClose,
}: SortableTabProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: instance,
		data: {
			type: "panel-tab",
			panel: panelSide,
			instance,
			kind,
			fromPanel: panelSide,
		},
	});

	const style: CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<TabButtonBase
			ref={setNodeRef}
			icon={icon}
			label={label}
			badgeCount={badgeCount}
			isActive={isActive}
			isFocused={isFocused}
			isPending={isPending}
			onClick={onClick}
			onClose={onClose}
			isDragging={isDragging}
			dataFocused={isFocused ? "true" : undefined}
			dataViewInstance={instance}
			dataViewKind={kind}
			style={style}
			buttonProps={{
				...(attributes as ButtonHTMLAttributes<HTMLButtonElement>),
				...(listeners as ButtonHTMLAttributes<HTMLButtonElement>),
			}}
		/>
	);
}

const tabBaseClasses =
	"group relative flex h-7 flex-none max-w-80 items-center gap-1.5 rounded-[7px] px-2.25 text-xs font-semibold transition-colors whitespace-nowrap";

const tabStateClasses = {
	// The focused chip is the one orange element on screen: the view
	// receiving keyboard input.
	focused:
		"bg-focus-tint text-neutral-900 ring-1 ring-inset ring-focus-ring [&_[data-tab-icon]]:text-brand-700",
	active: "bg-hover-soft text-neutral-900 [&_[data-tab-icon]]:text-neutral-500",
	idle: "bg-transparent text-neutral-500 hover:bg-hover-soft hover:text-neutral-900",
} as const;

interface TabBaseProps extends PanelTabPreviewProps {
	readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onClose?: () => void;
	readonly isDragging?: boolean;
	readonly dataFocused?: string;
	readonly dataViewInstance?: string;
	readonly dataViewKind?: string;
	readonly buttonProps?: ButtonHTMLAttributes<HTMLButtonElement> | null;
	readonly style?: CSSProperties;
}

const TabButtonBase = forwardRef<HTMLButtonElement, TabBaseProps>(
	(
		{
			icon: Icon,
			label,
			badgeCount,
			isActive,
			isFocused,
			isPending,
			onClick,
			onClose,
			isDragging,
			dataFocused,
			dataViewInstance,
			dataViewKind,
			buttonProps = null,
			style,
		},
		ref,
	) => {
		const state = isActive ? (isFocused ? "focused" : "active") : "idle";
		const { onClick: dragOnClick, ...restButtonProps } = buttonProps ?? {};
		return (
			<button
				type="button"
				onClick={(event) => {
					dragOnClick?.(event);
					onClick?.(event);
				}}
				ref={ref}
				data-focused={dataFocused}
				data-view-instance={dataViewInstance}
				data-view-key={dataViewKind}
				className={clsx(
					tabBaseClasses,
					tabStateClasses[state],
					isDragging && "opacity-50 cursor-grabbing",
				)}
				style={style}
				{...restButtonProps}
			>
				<span
					data-tab-icon
					className="relative flex size-3.25 items-center justify-center"
				>
					<Icon className="size-3.25" />
					{badgeCount ? (
						<span
							className={clsx(
								"pointer-events-none absolute -top-1 -left-1 flex h-4 min-w-[16px] -translate-y-1/2 items-center justify-center rounded-full px-[3px] text-[0.65rem] font-semibold leading-none transform",
								isActive
									? "bg-brand-600 text-white"
									: "bg-secondary text-secondary-foreground",
							)}
						>
							{badgeCount > 99 ? "99+" : badgeCount}
						</span>
					) : null}
				</span>
				<span
					className={clsx("max-w-[10rem] truncate", isPending && "italic")}
					title={label}
				>
					{label}
				</span>
				<span className="relative flex size-3.25 items-center justify-center">
					{onClose ? (
						<X
							className={clsx(
								"h-3 w-3",
								isActive && isFocused
									? "text-focus-close hover:text-brand-700"
									: isActive
										? "text-neutral-400 hover:text-neutral-600"
										: "text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-neutral-600",
							)}
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
						/>
					) : null}
				</span>
			</button>
		);
	},
);

TabButtonBase.displayName = "PanelTabButton";

export type PanelTabPreviewProps = {
	readonly icon: TabIcon;
	readonly label: string;
	readonly badgeCount?: number | null;
	readonly isActive: boolean;
	readonly isFocused: boolean;
	readonly isPending?: boolean;
};

export function PanelTabPreview(props: PanelTabPreviewProps) {
	return <TabButtonBase {...props} />;
}
