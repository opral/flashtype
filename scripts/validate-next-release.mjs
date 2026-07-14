#!/usr/bin/env node
import {
	currentVersion,
	loadNextRelease,
	NEXT_RELEASE_PATH,
	releaseVersion,
} from "./release.mjs";

try {
	const root = process.cwd();
	const release = loadNextRelease(root);
	if (!release) {
		console.log(`No ${NEXT_RELEASE_PATH} found.`);
		process.exit(0);
	}
	if (!release.body) {
		console.log(`${NEXT_RELEASE_PATH} has no release notes.`);
		process.exit(0);
	}
	const version = releaseVersion(currentVersion(root), release);
	console.log(`Validated ${NEXT_RELEASE_PATH} (${release.type}, v${version}).`);
} catch (error) {
	console.error(error.message);
	process.exit(1);
}
