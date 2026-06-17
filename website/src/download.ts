export const GITHUB_URL = "https://github.com/opral/flashtype";
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_RELEASES_URL}/latest`;
export const GITHUB_LATEST_RELEASE_API_URL =
	"https://api.github.com/repos/opral/flashtype/releases/latest";

type GitHubReleaseAsset = {
	name: string;
	browser_download_url: string;
};

type GitHubRelease = {
	assets?: GitHubReleaseAsset[];
};

export async function latestMacDmgDownloadUrl(): Promise<string> {
	const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
		headers: { Accept: "application/vnd.github+json" },
	});

	if (!response.ok) {
		throw new Error(`GitHub latest release request failed: ${response.status}`);
	}

	const release = (await response.json()) as GitHubRelease;
	const dmgAsset = release.assets?.find((asset) =>
		asset.name.endsWith("-mac-arm64.dmg"),
	);

	if (!dmgAsset) {
		throw new Error("Latest GitHub release does not include a macOS DMG asset");
	}

	return dmgAsset.browser_download_url;
}
