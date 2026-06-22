#!/usr/bin/env node

import { FsBackend, bundledPluginArchives, openLix } from "@lix-js/sdk";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultSeed = "flashtype-open-workspaces-v1";
const binarySizeChoices = Array.from(
	{ length: 10 },
	(_value, power) => 10 ** power,
);
const markdownWordChoices = Array.from(
	{ length: 4 },
	(_value, power) => 10 ** power,
);
const defaultOptions = {
	seed: defaultSeed,
	keep: false,
	binaryFiles: 1_000,
	binaryTotalBytes: 10_000_000_000,
	markdownFiles: 100,
	truncateConcurrency: 16,
};

try {
	await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const rng = createSeededRandom(options.seed);
	const tempRoot = await mkdtemp(
		path.join(tmpdir(), "flashtype-open-workspaces-"),
	);
	const binaryWorkspaceDir = path.join(tempRoot, "binary-large-workspace");
	const markdownWorkspaceDir = path.join(tempRoot, "markdown-workspace");

	console.log("Generated workspace open benchmark");
	console.log(`seed: ${options.seed}`);
	console.log(`temp root: ${tempRoot}`);

	try {
		await mkdir(binaryWorkspaceDir, { recursive: true });
		await mkdir(markdownWorkspaceDir, { recursive: true });

		const binaryMetadata = await measure(
			"generateBinaryWorkspace",
			async () => {
				return await generateBinaryWorkspace(binaryWorkspaceDir, options, rng);
			},
		);
		const markdownMetadata = await measure(
			"generateMarkdownWorkspace",
			async () => {
				return await generateMarkdownWorkspace(
					markdownWorkspaceDir,
					options,
					rng,
				);
			},
		);

		printWorkspaceMetadata(
			"binary workspace",
			binaryWorkspaceDir,
			binaryMetadata,
		);
		printWorkspaceMetadata(
			"markdown workspace",
			markdownWorkspaceDir,
			markdownMetadata,
		);

		const binaryProfile = await profileWorkspace(
			"binary workspace",
			binaryWorkspaceDir,
		);
		const markdownProfile = await profileWorkspace(
			"markdown workspace",
			markdownWorkspaceDir,
		);

		console.log("\nbenchmark summary:");
		console.log(
			`binary workspace totalProfile: ${formatDuration(
				binaryProfile.totalProfileMs,
			)}`,
		);
		console.log(
			`markdown workspace totalProfile: ${formatDuration(
				markdownProfile.totalProfileMs,
			)}`,
		);
	} finally {
		if (options.keep) {
			console.log(`\nkeeping generated workspaces under ${tempRoot}`);
		} else {
			await rm(tempRoot, { force: true, recursive: true });
			console.log(`\nremoved generated workspaces under ${tempRoot}`);
		}
	}
}

async function generateBinaryWorkspace(workspaceDir, options, rng) {
	const { sizes, buckets } = generateExactPowerOfTenSizes({
		fileCount: options.binaryFiles,
		totalBytes: options.binaryTotalBytes,
		rng,
	});
	shuffle(sizes, rng);

	await runLimited(
		sizes.map((size, index) => async () => {
			const filePath = path.join(
				workspaceDir,
				`binary-${String(index + 1).padStart(4, "0")}.bin`,
			);
			await execFileAsync("truncate", ["-s", String(size), filePath]);
		}),
		options.truncateConcurrency,
	);

	return {
		fileCount: sizes.length,
		totalBytes: sizes.reduce((sum, size) => sum + size, 0),
		buckets,
	};
}

async function generateMarkdownWorkspace(workspaceDir, options, rng) {
	const buckets = new Map(
		markdownWordChoices.map((wordCount) => [wordCount, 0]),
	);
	let totalBodyWords = 0;

	for (let index = 0; index < options.markdownFiles; index += 1) {
		const bodyWordCount = randomChoice(markdownWordChoices, rng);
		buckets.set(bodyWordCount, (buckets.get(bodyWordCount) ?? 0) + 1);
		totalBodyWords += bodyWordCount;

		const words = Array.from({ length: bodyWordCount }, (_value, wordIndex) =>
			generatedWord(index, wordIndex),
		);
		const content = `# Generated note ${index + 1}\n\n${wrapWords(words)}\n`;
		await writeFile(
			path.join(workspaceDir, `note-${String(index + 1).padStart(3, "0")}.md`),
			content,
			"utf8",
		);
	}

	return {
		fileCount: options.markdownFiles,
		totalBodyWords,
		buckets: [...buckets.entries()].map(([wordCount, count]) => ({
			label: `${wordCount} body words`,
			count,
		})),
	};
}

async function profileWorkspace(label, workspaceDir) {
	console.log(`\nprofiling ${label}:`);
	const measurements = [];
	const profileStarted = performance.now();
	let lix;
	let installedPluginCount = 0;

	try {
		lix = await measureProfile(measurements, "openLix", async () => {
			return await openLix({
				backend: new FsBackend({
					path: workspaceDir,
					storage: "persistent",
				}),
			});
		});

		installedPluginCount = await measureProfile(
			measurements,
			"ensureDefaultPluginsInstalledOnCurrentBranch",
			async () => {
				const plugins = await bundledPluginArchives();
				for (const plugin of plugins) {
					const archivePath = `/.lix/plugins/${plugin.key}.lixplugin`;
					const existing = await readLixFileBytes(lix, archivePath);
					if (!bytesEqual(existing, plugin.archiveBytes)) {
						await writeLixFileBytes(lix, archivePath, plugin.archiveBytes);
					}
				}
				return plugins.length;
			},
		);
	} finally {
		if (lix) {
			await measureProfile(measurements, "close", async () => {
				await lix.close();
			});
		}
	}

	const totalProfileMs = performance.now() - profileStarted;
	measurements.push({ label: "totalProfile", durationMs: totalProfileMs });

	console.log(`installed plugins: ${installedPluginCount}`);
	console.log(`${label} summary:`);
	for (const measurement of measurements) {
		console.log(
			`  ${measurement.label}: ${formatDuration(measurement.durationMs)}`,
		);
	}

	return { measurements, totalProfileMs };
}

async function readLixFileBytes(lix, filePath) {
	const result = await lix.execute(
		"SELECT data FROM lix_file WHERE path = $1",
		[filePath],
	);
	return result.rows[0]?.value("data").asBytes();
}

async function writeLixFileBytes(lix, filePath, data) {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[filePath, data],
	);
}

function bytesEqual(actual, expected) {
	if (!(actual instanceof Uint8Array)) {
		return false;
	}
	return Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0;
}

async function measure(label, fn) {
	const started = performance.now();
	const result = await fn();
	console.log(`${label}: ${formatDuration(performance.now() - started)}`);
	return result;
}

async function measureProfile(measurements, label, fn) {
	const started = performance.now();
	try {
		return await fn();
	} finally {
		const durationMs = performance.now() - started;
		measurements.push({ label, durationMs });
		console.log(`${label}: ${formatDuration(durationMs)}`);
	}
}

function generateExactPowerOfTenSizes({ fileCount, totalBytes, rng }) {
	validateExactSizeRequest(fileCount, totalBytes);

	const countsByPower = Array(binarySizeChoices.length).fill(0);
	const feasibleMemo = new Map();
	let remainingCount = fileCount;
	let remainingBytes = totalBytes;

	function feasible(maxPower, count, bytes) {
		const key = `${maxPower}:${count}:${bytes}`;
		const cached = feasibleMemo.get(key);
		if (cached !== undefined) {
			return cached;
		}

		let result;
		if (count < 0 || bytes < 0) {
			result = false;
		} else if (count === 0) {
			result = bytes === 0;
		} else if (
			bytes < count ||
			bytes > count * binarySizeChoices[maxPower] ||
			(bytes - count) % 9 !== 0
		) {
			result = false;
		} else if (maxPower === 0) {
			result = bytes === count;
		} else {
			const currentSize = binarySizeChoices[maxPower];
			const nextLargestSize = binarySizeChoices[maxPower - 1];
			const minCurrentCount = Math.max(
				0,
				Math.ceil(
					(bytes - count * nextLargestSize) / (currentSize - nextLargestSize),
				),
			);
			const maxCurrentCount = Math.min(
				count,
				Math.floor((bytes - count) / (currentSize - 1)),
				Math.floor(bytes / currentSize),
			);
			result = false;
			for (
				let currentCount = minCurrentCount;
				currentCount <= maxCurrentCount;
				currentCount += 1
			) {
				if (
					feasible(
						maxPower - 1,
						count - currentCount,
						bytes - currentCount * currentSize,
					)
				) {
					result = true;
					break;
				}
			}
		}

		feasibleMemo.set(key, result);
		return result;
	}

	for (let power = binarySizeChoices.length - 1; power > 0; power -= 1) {
		const currentSize = binarySizeChoices[power];
		const nextLargestSize = binarySizeChoices[power - 1];
		const minCurrentCount = Math.max(
			0,
			Math.ceil(
				(remainingBytes - remainingCount * nextLargestSize) /
					(currentSize - nextLargestSize),
			),
		);
		const maxCurrentCount = Math.min(
			remainingCount,
			Math.floor((remainingBytes - remainingCount) / (currentSize - 1)),
			Math.floor(remainingBytes / currentSize),
		);
		const candidates = [];

		for (
			let currentCount = minCurrentCount;
			currentCount <= maxCurrentCount;
			currentCount += 1
		) {
			if (
				feasible(
					power - 1,
					remainingCount - currentCount,
					remainingBytes - currentCount * currentSize,
				)
			) {
				candidates.push(currentCount);
			}
		}

		if (candidates.length === 0) {
			throw new Error(
				`Could not generate ${fileCount} binary files totaling ${totalBytes} bytes.`,
			);
		}

		const selectedCount = randomChoice(candidates, rng);
		countsByPower[power] = selectedCount;
		remainingCount -= selectedCount;
		remainingBytes -= selectedCount * currentSize;
	}

	countsByPower[0] = remainingCount;

	const sizes = countsByPower.flatMap((count, power) =>
		Array.from({ length: count }, () => binarySizeChoices[power]),
	);
	const buckets = countsByPower.map((count, power) => ({
		label: `10^${power} bytes`,
		count,
	}));

	return { sizes, buckets };
}

function validateExactSizeRequest(fileCount, totalBytes) {
	if (!Number.isSafeInteger(fileCount) || fileCount <= 0) {
		throw new Error("--binary-files must be a positive safe integer.");
	}
	if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
		throw new Error("--binary-total-bytes must be a positive safe integer.");
	}
	const minBytes = fileCount * binarySizeChoices[0];
	const maxBytes = fileCount * binarySizeChoices.at(-1);
	if (totalBytes < minBytes || totalBytes > maxBytes) {
		throw new Error(
			`--binary-total-bytes must be between ${minBytes} and ${maxBytes} for ${fileCount} files.`,
		);
	}
	if ((totalBytes - fileCount) % 9 !== 0) {
		throw new Error(
			"--binary-total-bytes is not representable by the requested number of 10^0..10^9 byte files.",
		);
	}
}

function printWorkspaceMetadata(label, workspaceDir, metadata) {
	console.log(`\n${label}:`);
	console.log(`  path: ${workspaceDir}`);
	console.log(`  files: ${metadata.fileCount}`);
	if (metadata.totalBytes !== undefined) {
		console.log(`  bytes: ${metadata.totalBytes}`);
	}
	if (metadata.totalBodyWords !== undefined) {
		console.log(`  body words: ${metadata.totalBodyWords}`);
	}
	console.log("  buckets:");
	for (const bucket of metadata.buckets) {
		console.log(`    ${bucket.label}: ${bucket.count}`);
	}
}

function generatedWord(fileIndex, wordIndex) {
	return `word${fileIndex.toString(36)}_${wordIndex.toString(36)}`;
}

function wrapWords(words) {
	const lines = [];
	for (let index = 0; index < words.length; index += 12) {
		lines.push(words.slice(index, index + 12).join(" "));
	}
	return lines.join("\n");
}

async function runLimited(tasks, concurrency) {
	if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
		throw new Error("--truncate-concurrency must be a positive safe integer.");
	}

	let nextIndex = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, tasks.length) },
		async () => {
			while (nextIndex < tasks.length) {
				const taskIndex = nextIndex;
				nextIndex += 1;
				await tasks[taskIndex]();
			}
		},
	);
	await Promise.all(workers);
}

function randomChoice(values, rng) {
	return values[Math.floor(rng() * values.length)];
}

function shuffle(values, rng) {
	for (let index = values.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(rng() * (index + 1));
		[values[index], values[swapIndex]] = [values[swapIndex], values[index]];
	}
}

function createSeededRandom(seed) {
	let state = 0x811c9dc5;
	for (const char of String(seed)) {
		state ^= char.charCodeAt(0);
		state = Math.imul(state, 0x01000193);
	}
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function parseArgs(args) {
	const options = { ...defaultOptions };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		if (arg === "--keep") {
			options.keep = true;
			continue;
		}

		const [name, inlineValue] = arg.split("=", 2);
		const value =
			inlineValue !== undefined
				? inlineValue
				: readNextArgValue(args, ++index, arg);

		switch (name) {
			case "--seed":
				options.seed = value;
				break;
			case "--binary-files":
				options.binaryFiles = parsePositiveInteger(name, value);
				break;
			case "--binary-total-bytes":
				options.binaryTotalBytes = parsePositiveInteger(name, value);
				break;
			case "--markdown-files":
				options.markdownFiles = parsePositiveInteger(name, value);
				break;
			case "--truncate-concurrency":
				options.truncateConcurrency = parsePositiveInteger(name, value);
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function readNextArgValue(args, index, flag) {
	const value = args[index];
	if (value === undefined || value.startsWith("--")) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function parsePositiveInteger(name, value) {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive safe integer.`);
	}
	return parsed;
}

function printHelp() {
	console.log(`usage: node scripts/profile-generated-workspaces.mjs [options]

Generates sparse binary and markdown workspaces, profiles openLix(FsBackend),
installs default bundled plugins, and removes the generated temp directory by
default.

Options:
  --seed <seed>                       Deterministic generation seed.
  --keep                              Keep generated workspaces after profiling.
  --binary-files <count>              Binary .bin file count. Default: 1000.
  --binary-total-bytes <bytes>        Exact sparse binary total. Default: 10000000000.
  --markdown-files <count>            Markdown .md file count. Default: 100.
  --truncate-concurrency <count>      Concurrent truncate commands. Default: 16.
  --help                              Show this message.

Smoke example:
  node scripts/profile-generated-workspaces.mjs --binary-files=10 --binary-total-bytes=10000 --markdown-files=5 --seed=smoke
`);
}

function formatDuration(durationMs) {
	return `${durationMs.toFixed(1)}ms`;
}
