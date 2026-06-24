import type { CSSProperties, JSX } from "react";

type AnimatedZapProps = {
	readonly className?: string;
	readonly size?: number | string;
	readonly label?: string;
	readonly tone?: "inherit" | "brand" | "muted";
	readonly variant?: "solid" | "outline";
	readonly strokeWidth?: number;
	readonly fill?: string;
};

export function AnimatedZap({
	className = "",
	size = 72,
	label,
	tone = "inherit",
	variant = "solid",
	strokeWidth = 7,
	fill = "var(--color-bg-panel)",
}: AnimatedZapProps): JSX.Element {
	const toneColor =
		tone === "brand"
			? "var(--color-icon-brand)"
			: tone === "muted"
				? "var(--color-text-tertiary)"
				: undefined;
	const style = {
		"--flashtype-zap-width": typeof size === "number" ? `${size}px` : size,
		"--flashtype-zap-fill": fill,
		...(toneColor ? { "--flashtype-zap-color": toneColor } : {}),
	} as CSSProperties;
	const accessibilityProps = {
		role: label ? "img" : undefined,
		"aria-label": label,
		"aria-hidden": label ? undefined : true,
	};

	if (variant === "outline") {
		return (
			<svg
				{...accessibilityProps}
				className={`flashtype-zap-build flashtype-zap-build--outline ${className}`}
				style={style}
				viewBox="-7 -7 89 114"
				fill="none"
				focusable="false"
			>
				<path
					className="flashtype-zap-build__outline-fill"
					d={BOLT_PATH}
					fill="var(--flashtype-zap-fill, var(--color-bg-app))"
				/>
				<path
					className="flashtype-zap-build__outline-base"
					d={BOLT_PATH}
					pathLength={100}
					stroke="currentColor"
					strokeWidth={strokeWidth}
					strokeLinejoin="round"
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
				<path
					className="flashtype-zap-build__outline-draw"
					d={BOLT_PATH}
					pathLength={100}
					stroke="currentColor"
					strokeWidth={strokeWidth}
					strokeLinejoin="round"
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
		);
	}

	return (
		<div
			className={`flashtype-zap-build ${className}`}
			style={style}
			{...accessibilityProps}
		>
			<div className="flashtype-zap-build__base" />
			<div className="flashtype-zap-build__segment flashtype-zap-build__segment--top">
				<div className="flashtype-zap-build__wipe flashtype-zap-build__wipe--top" />
			</div>
			<div className="flashtype-zap-build__segment flashtype-zap-build__segment--middle">
				<div className="flashtype-zap-build__wipe flashtype-zap-build__wipe--middle" />
			</div>
			<div className="flashtype-zap-build__segment flashtype-zap-build__segment--bottom">
				<div className="flashtype-zap-build__wipe flashtype-zap-build__wipe--bottom" />
			</div>
		</div>
	);
}

const BOLT_PATH =
	"M42.525 0 L0 57.5 H32.475 L24.975 100 L75 37.5 H39.975 L42.525 0 Z";
