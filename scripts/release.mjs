import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const CHANGE_TYPES = ["major", "minor", "patch"];
export const NEXT_RELEASE_PATH = "NEXT_RELEASE.md";
export const DEFAULT_NEXT_RELEASE_TEXT = `---
type: patch
---
`;

export function readText(root, path) {
	return readFileSync(join(root, path), "utf8");
}

export function writeText(root, path, text) {
	writeFileSync(join(root, path), text);
}

export function readJson(root, path) {
	return JSON.parse(readText(root, path));
}

export function writeJson(root, path, value) {
	writeText(root, path, `${JSON.stringify(value, null, "\t")}\n`);
}

export function currentVersion(root) {
	const packageJson = readJson(root, "package.json");
	if (!packageJson.version) {
		throw new Error("Could not find version in package.json");
	}
	return packageJson.version;
}

export function bumpVersion(version, type) {
	const { major, minor, patch } = parseVersion(version);
	if (type === "major") return `${major + 1}.0.0`;
	if (type === "minor") return `${major}.${minor + 1}.0`;
	if (type === "patch") return `${major}.${minor}.${patch + 1}`;
	throw new Error(`Unsupported change type: ${type}`);
}

export function releaseVersion(current, release) {
	if (!release.version) {
		return bumpVersion(current, release.type);
	}

	const from = parseVersion(current);
	const to = parseVersion(release.version);
	const validTarget =
		(release.type === "major" &&
			to.major > from.major &&
			to.minor === 0 &&
			to.patch === 0) ||
		(release.type === "minor" &&
			to.major === from.major &&
			to.minor > from.minor &&
			to.patch === 0) ||
		(release.type === "patch" &&
			to.major === from.major &&
			to.minor === from.minor &&
			to.patch > from.patch);
	if (!validTarget) {
		throw new Error(
			`${NEXT_RELEASE_PATH}: version ${release.version} is not a later ${release.type} release from ${current}`,
		);
	}
	return release.version;
}

export function loadNextRelease(root) {
	const path = NEXT_RELEASE_PATH;
	if (!existsSync(join(root, path))) return null;
	const text = readText(root, path).replace(/\r\n/g, "\n").trim();
	const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		throw new Error(
			`${path}: expected frontmatter followed by an optional changelog body`,
		);
	}
	const metadata = Object.fromEntries(
		match[1]
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const separator = line.indexOf(":");
				if (separator === -1)
					throw new Error(`${path}: invalid frontmatter line "${line}"`);
				return [
					line.slice(0, separator).trim(),
					line.slice(separator + 1).trim(),
				];
			}),
	);
	const type = metadata.type;
	const version = metadata.version || undefined;
	const body = normalizeReleaseBody(match[2]);
	if (!CHANGE_TYPES.includes(type)) {
		throw new Error(`${path}: type must be one of ${CHANGE_TYPES.join(", ")}`);
	}
	if (version) {
		parseVersion(version);
	}
	return {
		path,
		type,
		version,
		body,
	};
}

export function changelogEntry(version, date, release) {
	return `## ${version} - ${date}\n\n${release.body}\n`;
}

function normalizeReleaseBody(body) {
	return body.replace(/\r\n/g, "\n").trim();
}

export function updatePackageVersion(root, version) {
	const packageJson = readJson(root, "package.json");
	packageJson.version = version;
	writeJson(root, "package.json", packageJson);
}

export function updateChangelog(root, version, date, release) {
	const path = "CHANGELOG.md";
	const existing = existsSync(join(root, path))
		? readText(root, path).trimEnd()
		: "# Changelog\n";
	const entry = changelogEntry(version, date, release).trimEnd();
	const next =
		existing.trim() === "# Changelog"
			? `# Changelog\n\n${entry}\n`
			: `${existing.replace(/^# Changelog\n*/, `# Changelog\n\n${entry}\n\n`)}\n`;
	writeText(root, path, next);
}

export function prepareRelease(
	root,
	{ date = new Date().toISOString().slice(0, 10) } = {},
) {
	const release = loadNextRelease(root);
	if (!release || !release.body) {
		return null;
	}
	const type = release.type;
	const version = releaseVersion(currentVersion(root), release);
	updatePackageVersion(root, version);
	updateChangelog(root, version, date, release);
	writeText(root, NEXT_RELEASE_PATH, DEFAULT_NEXT_RELEASE_TEXT);
	return { version, type, release };
}

function parseVersion(version) {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
	if (!match) {
		throw new Error(`Unsupported version format: ${version}`);
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

export function releaseTagForHead(root) {
	const message = execFileSync("git", ["log", "-1", "--pretty=%B"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	const match =
		message.match(/Release v(\d+\.\d+\.\d+)/) ??
		releaseCommitMatchForMergedHead(root);
	if (!match) return null;
	const version = currentVersion(root);
	if (version !== match[1]) {
		throw new Error(
			`Release commit says ${match[1]}, but package.json says ${version}`,
		);
	}
	return `v${version}`;
}

function releaseCommitMatchForMergedHead(root) {
	const parents = execFileSync("git", ["show", "-s", "--pretty=%P", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	})
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (parents.length < 2) return null;

	const introducedMessages = execFileSync(
		"git",
		["log", "--format=%B%x00", `${parents[0]}..HEAD`],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	return introducedMessages.match(/Release v(\d+\.\d+\.\d+)/);
}
