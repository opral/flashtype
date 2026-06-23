import {
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
	if (!match) {
		throw new Error(`Unsupported version format: ${version}`);
	}
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (type === "major") return `${major + 1}.0.0`;
	if (type === "minor") return `${major}.${minor + 1}.0`;
	if (type === "patch") return `${major}.${minor}.${patch + 1}`;
	throw new Error(`Unsupported change type: ${type}`);
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
	const body = normalizeReleaseBody(match[2]);
	if (!CHANGE_TYPES.includes(type)) {
		throw new Error(`${path}: type must be one of ${CHANGE_TYPES.join(", ")}`);
	}
	return {
		path,
		type,
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
	const version = bumpVersion(currentVersion(root), type);
	updatePackageVersion(root, version);
	updateChangelog(root, version, date, release);
	writeText(root, NEXT_RELEASE_PATH, DEFAULT_NEXT_RELEASE_TEXT);
	return { version, type, release };
}

export function releaseTagForHead(root) {
	const message = execFileSync("git", ["log", "-1", "--pretty=%B"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	const match = message.match(/Release v(\d+\.\d+\.\d+)/);
	if (!match) return null;
	const version = currentVersion(root);
	if (version !== match[1]) {
		throw new Error(
			`Release commit says ${match[1]}, but package.json says ${version}`,
		);
	}
	return `v${version}`;
}
