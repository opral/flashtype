const MUTED_BLOCK_BACKGROUND = ["48", "2", "68", "64", "60"];
const MUTED_BLOCK_FOREGROUND = ["38", "2", "231", "229", "228"];
const ESCAPE_PATTERN = "\\x1B";
const SGR_PATTERN = new RegExp(`${ESCAPE_PATTERN}\\[([0-9;]*)m`, "g");
const INCOMPLETE_ESCAPE_PATTERN = new RegExp(
	`${ESCAPE_PATTERN}(?:\\[[0-9;]*)?$`,
);

export function createTerminalOutputNormalizer() {
	let pending = "";
	let mutedBackgroundActive = false;

	const normalize = (data: string) => {
		const combined = pending + data;
		const { complete, remainder } = splitCompleteAnsiInput(combined);
		pending = remainder;
		return complete.replace(SGR_PATTERN, (_match, params) => {
			const result = normalizeSgr(params, mutedBackgroundActive);
			mutedBackgroundActive = result.mutedBackgroundActive;
			return `\x1b[${result.params.join(";")}m`;
		});
	};

	return {
		write: normalize,
		flush() {
			const rest = pending;
			pending = "";
			return rest;
		},
	};
}

function splitCompleteAnsiInput(input: string) {
	const incompleteMatch = input.match(INCOMPLETE_ESCAPE_PATTERN);
	if (!incompleteMatch) {
		return { complete: input, remainder: "" };
	}
	const index = incompleteMatch.index ?? input.length;
	return {
		complete: input.slice(0, index),
		remainder: input.slice(index),
	};
}

function normalizeSgr(paramsText: string, mutedBackgroundActive: boolean) {
	const params = paramsText.length > 0 ? paramsText.split(";") : ["0"];
	const next: string[] = [];
	let active = mutedBackgroundActive;

	for (let i = 0; i < params.length; i += 1) {
		const raw = params[i] || "0";
		const value = Number(raw);

		if (value === 0) {
			active = false;
			next.push(raw);
			continue;
		}

		if (value === 39) {
			next.push(raw);
			continue;
		}

		if (value === 49) {
			active = false;
			next.push(raw);
			continue;
		}

		if (isBasicMutedBackground(value)) {
			active = true;
			next.push(...MUTED_BLOCK_BACKGROUND);
			continue;
		}

		if (isBasicBackground(value)) {
			active = false;
			next.push(raw);
			continue;
		}

		if (isBasicDiffForeground(value) && active) {
			next.push(...MUTED_BLOCK_FOREGROUND);
			continue;
		}

		if (value === 48 || value === 38) {
			const parsed = parseExtendedColor(params, i);
			if (parsed) {
				const isBackground = value === 48;
				const shouldMuteBackground =
					isBackground && shouldMuteBackgroundColor(parsed.rgb);
				const shouldMuteForeground =
					!isBackground && active && shouldMuteDiffForeground(parsed.rgb);

					if (shouldMuteBackground) {
						active = true;
						next.push(...MUTED_BLOCK_BACKGROUND);
						i = parsed.endIndex;
						continue;
					}

					if (shouldMuteForeground) {
						next.push(...MUTED_BLOCK_FOREGROUND);
						i = parsed.endIndex;
						continue;
					}

					if (isBackground) {
						active = false;
					}
					next.push(...params.slice(i, parsed.endIndex + 1));
					i = parsed.endIndex;
					continue;
				}
			}

		next.push(raw);
	}

	return {
		params: next.length > 0 ? next : ["0"],
		mutedBackgroundActive: active,
	};
}

function parseExtendedColor(params: string[], startIndex: number) {
	const mode = Number(params[startIndex + 1]);
	if (mode === 2) {
		const rgb = [
			Number(params[startIndex + 2]),
			Number(params[startIndex + 3]),
			Number(params[startIndex + 4]),
		] as const;
		if (rgb.every(Number.isFinite)) {
			return { rgb, endIndex: startIndex + 4 };
		}
	}

	if (mode === 5) {
		const colorIndex = Number(params[startIndex + 2]);
		if (Number.isFinite(colorIndex)) {
			return {
				rgb: xterm256ColorToRgb(colorIndex),
				endIndex: startIndex + 2,
			};
		}
	}

	return null;
}

function isBasicMutedBackground(value: number) {
	return (
		value === 40 ||
		value === 41 ||
		value === 42 ||
		value === 100 ||
		value === 101 ||
		value === 102
	);
}

function isBasicBackground(value: number) {
	return (value >= 40 && value <= 47) || (value >= 100 && value <= 107);
}

function isBasicDiffForeground(value: number) {
	return value === 31 || value === 32 || value === 91 || value === 92;
}

function shouldMuteBackgroundColor([red, green, blue]: readonly number[]) {
	const luminance = relativeLuminance(red, green, blue);
	const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
	const looksRed = red > green * 1.25 && red > blue * 1.25;
	const looksGreen = green > red * 1.15 && green > blue * 1.15;
	const looksBlack = luminance < 0.06 && spread < 24;
	return looksBlack || looksRed || looksGreen;
}

function shouldMuteDiffForeground([red, green, blue]: readonly number[]) {
	const looksRed = red > green * 1.25 && red > blue * 1.25;
	const looksGreen = green > red * 1.15 && green > blue * 1.15;
	return looksRed || looksGreen;
}

function relativeLuminance(red: number, green: number, blue: number) {
	return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function xterm256ColorToRgb(index: number): readonly [number, number, number] {
	const basicColors: readonly (readonly [number, number, number])[] = [
		[0, 0, 0],
		[128, 0, 0],
		[0, 128, 0],
		[128, 128, 0],
		[0, 0, 128],
		[128, 0, 128],
		[0, 128, 128],
		[192, 192, 192],
		[128, 128, 128],
		[255, 0, 0],
		[0, 255, 0],
		[255, 255, 0],
		[0, 0, 255],
		[255, 0, 255],
		[0, 255, 255],
		[255, 255, 255],
	];
	if (index < basicColors.length) {
		return basicColors[index] ?? [0, 0, 0];
	}
	if (index >= 16 && index <= 231) {
		const color = index - 16;
		const red = Math.floor(color / 36);
		const green = Math.floor((color % 36) / 6);
		const blue = color % 6;
		return [cubeValue(red), cubeValue(green), cubeValue(blue)];
	}
	if (index >= 232 && index <= 255) {
		const gray = 8 + (index - 232) * 10;
		return [gray, gray, gray];
	}
	return [0, 0, 0];
}

function cubeValue(value: number) {
	return value === 0 ? 0 : 55 + value * 40;
}
