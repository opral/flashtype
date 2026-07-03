import { useEffect, useState } from "react";
import {
	GITHUB_LATEST_RELEASE_URL,
	latestMacDmgDownloadUrl,
} from "./download";

const DOWNLOAD_REDIRECT_DELAY_MS = 250;

export function DownloadHandoffPage({ title }: { title: string }) {
	const [downloadUrl, setDownloadUrl] = useState(GITHUB_LATEST_RELEASE_URL);

	useEffect(() => {
		let isCurrent = true;
		let redirectTimeout: ReturnType<typeof setTimeout> | undefined;

		async function startDownload() {
			try {
				const url = await latestMacDmgDownloadUrl();
				if (!isCurrent) return;
				setDownloadUrl(url);
				redirectTimeout = setTimeout(() => {
					window.location.replace(url);
				}, DOWNLOAD_REDIRECT_DELAY_MS);
			} catch (error) {
				console.error(error);
				redirectTimeout = setTimeout(() => {
					window.location.replace(GITHUB_LATEST_RELEASE_URL);
				}, DOWNLOAD_REDIRECT_DELAY_MS);
			}
		}

		startDownload();

		return () => {
			isCurrent = false;
			if (redirectTimeout) {
				clearTimeout(redirectTimeout);
			}
		};
	}, []);

	return (
		<main className="flex min-h-screen items-center justify-center bg-paper px-[24px] text-center text-ink">
			<div className="flex max-w-[520px] flex-col items-center gap-[18px]">
				<a
					href="/"
					className="flex items-center gap-[9px] text-[19px] font-bold tracking-normal text-ink no-underline"
					aria-label="Flashtype home"
				>
					<span>Flashtype</span>
				</a>
				<h1 className="m-0 text-[34px] font-bold leading-[1.1] tracking-normal">
					{title}
				</h1>
				<p className="m-0 text-[17px] leading-[1.6] text-secondary">
					If the download does not start automatically, use the link below.
				</p>
				<a
					href={downloadUrl}
					className="inline-flex items-center justify-center rounded-[14px] border border-transparent bg-[linear-gradient(180deg,#F97316_0%,#E8590C_100%)] px-[26px] py-[15px] font-bold leading-none text-white no-underline shadow-[0_12px_34px_rgba(232,89,12,0.4),inset_0_1px_0_rgba(255,255,255,0.25)]"
				>
					Download for Mac
				</a>
			</div>
		</main>
	);
}
