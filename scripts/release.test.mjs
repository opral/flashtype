import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	DEFAULT_NEXT_RELEASE_TEXT,
	prepareRelease,
	releaseTagForHead,
	releaseVersion,
} from "./release.mjs";

const repos = [];

afterEach(() => {
	while (repos.length > 0) {
		rmSync(repos.pop(), { force: true, recursive: true });
	}
});

describe("releaseTagForHead", () => {
	test("detects a direct release commit", () => {
		const repo = createRepo();
		writePackageJson(repo, "0.7.0");
		commit(repo, "Release v0.7.0");

		expect(releaseTagForHead(repo)).toBe("v0.7.0");
	});

	test("detects a release commit merged through a PR merge commit", () => {
		const repo = createRepo();
		writePackageJson(repo, "0.6.1");
		commit(repo, "Initial release state");

		git(repo, "checkout", "-b", "release/next");
		writePackageJson(repo, "0.7.0");
		commit(repo, "Release v0.7.0");

		git(repo, "checkout", "main");
		git(
			repo,
			"merge",
			"--no-ff",
			"release/next",
			"-m",
			"Merge pull request #236 from opral/release/next",
		);

		expect(releaseTagForHead(repo)).toBe("v0.7.0");
	});

	test("ignores merge commits without a release commit", () => {
		const repo = createRepo();
		writePackageJson(repo, "0.7.0");
		commit(repo, "Initial release state");

		git(repo, "checkout", "-b", "feature");
		writeFileSync(join(repo, "README.md"), "notes\n");
		commit(repo, "Add notes");

		git(repo, "checkout", "main");
		git(repo, "merge", "--no-ff", "feature", "-m", "Merge pull request #1");

		expect(releaseTagForHead(repo)).toBeNull();
	});
});

describe("explicit release versions", () => {
	test("prepares the requested later minor version", () => {
		const repo = createRepo();
		writePackageJson(repo, "0.7.3");
		writeFileSync(
			join(repo, "NEXT_RELEASE.md"),
			"---\ntype: minor\nversion: 0.9.0\n---\n\n- Upgrade Atelier and Lix.\n",
		);

		const result = prepareRelease(repo, { date: "2026-07-14" });

		expect(result?.version).toBe("0.9.0");
		expect(readPackageVersion(repo)).toBe("0.9.0");
		expect(readFileSync(join(repo, "CHANGELOG.md"), "utf8")).toContain(
			"## 0.9.0 - 2026-07-14\n\n- Upgrade Atelier and Lix.",
		);
		expect(readFileSync(join(repo, "NEXT_RELEASE.md"), "utf8")).toBe(
			DEFAULT_NEXT_RELEASE_TEXT,
		);
	});

	test("rejects a target that does not match the release type", () => {
		expect(() =>
			releaseVersion("0.7.3", { type: "minor", version: "1.0.0" }),
		).toThrow("is not a later minor release from 0.7.3");
	});
});

function createRepo() {
	const repo = mkdtempSync(join(tmpdir(), "flashtype-release-test-"));
	repos.push(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "test@example.com");
	git(repo, "config", "user.name", "Test User");
	return repo;
}

function writePackageJson(repo, version) {
	writeFileSync(
		join(repo, "package.json"),
		`${JSON.stringify({ name: "test", version }, null, "\t")}\n`,
	);
}

function readPackageVersion(repo) {
	return JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
}

function commit(repo, message) {
	git(repo, "add", ".");
	git(repo, "commit", "-m", message);
}

function git(repo, ...args) {
	return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
