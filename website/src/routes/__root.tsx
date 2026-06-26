import {
	createRootRoute,
	HeadContent,
	Scripts,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { GITHUB_LATEST_RELEASE_URL, GITHUB_URL } from "../download";
import { PostHogAnalytics } from "../posthog-analytics";
import appCss from "../styles.css?url";

const GA_MEASUREMENT_ID = "G-1M7SY9LBT7";
const siteUrl = "https://flashtype.com/";
const title = "Flashtype | The markdown editor for Claude & Codex";
const description =
	"A WYSIWYG markdown editor with Claude Code and Codex built in. Agents edit, you review diffs. Accept or reject every change. Free and open source.";
const imageAlt =
	"Screenshot-style preview of the Flashtype markdown editor with Claude Code and Codex panels";
const structuredData = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "SoftwareApplication",
			name: "Flashtype",
			description,
			url: siteUrl,
			image: "https://flashtype.com/og.png",
			screenshot: "https://flashtype.com/og.png",
			applicationCategory: "ProductivityApplication",
			applicationSubCategory: "Markdown editor",
			operatingSystem: "macOS",
			softwareRequirements: "macOS",
			isAccessibleForFree: true,
			license: `${GITHUB_URL}/blob/main/LICENSE`,
			codeRepository: GITHUB_URL,
			downloadUrl: GITHUB_LATEST_RELEASE_URL,
			installUrl: GITHUB_LATEST_RELEASE_URL,
			sameAs: [GITHUB_URL],
			offers: {
				"@type": "Offer",
				price: "0",
				priceCurrency: "USD",
			},
			creator: {
				"@type": "Organization",
				name: "Opral",
				url: "https://opral.com",
			},
			publisher: {
				"@type": "Organization",
				name: "Opral",
				url: "https://opral.com",
			},
		},
		{
			"@type": "FAQPage",
			mainEntity: [
				{
					"@type": "Question",
					name: "What is Flashtype?",
					acceptedAnswer: {
						"@type": "Answer",
						text: "Flashtype is a free, open-source macOS markdown editor with Claude Code and Codex built in.",
					},
				},
				{
					"@type": "Question",
					name: "Does Flashtype work with local files?",
					acceptedAnswer: {
						"@type": "Answer",
						text: "Yes. Flashtype opens folders on disk and keeps documents as plain .md files without a proprietary format.",
					},
				},
				{
					"@type": "Question",
					name: "How are AI edits reviewed?",
					acceptedAnswer: {
						"@type": "Answer",
						text: "Claude Code and Codex can edit the same files, and Flashtype shows their changes as inline diffs before you accept or reject them.",
					},
				},
			],
		},
	],
};
const googleAnalyticsScripts = import.meta.env.PROD
	? [
			{
				async: true,
				src: `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`,
			},
			{
				children: `
					window.dataLayer = window.dataLayer || [];
					function gtag(){window.dataLayer.push(arguments);}
					window.gtag = gtag;
					gtag('js', new Date());
					gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
				`,
			},
		]
	: [];

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title },
			{ name: "description", content: description },
			{ name: "robots", content: "index, follow" },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:type", content: "website" },
			{ property: "og:url", content: siteUrl },
			{ property: "og:site_name", content: "Flashtype" },
			{ property: "og:image", content: "https://flashtype.com/og.png" },
			{ property: "og:image:width", content: "1200" },
			{ property: "og:image:height", content: "630" },
			{ property: "og:image:type", content: "image/png" },
			{ property: "og:image:alt", content: imageAlt },
			{ name: "twitter:card", content: "summary_large_image" },
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
			{ name: "twitter:image", content: "https://flashtype.com/og.png" },
			{ name: "twitter:image:alt", content: imageAlt },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "canonical", href: siteUrl },
			{ rel: "sitemap", type: "application/xml", href: "/sitemap.xml" },
			{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..900&family=JetBrains+Mono:wght@400;500;600&display=swap",
			},
		],
		scripts: googleAnalyticsScripts,
	}),
	shellComponent: RootDocument,
});

function GoogleAnalyticsPageViews() {
	const router = useRouter();
	const history = router.history;

	useEffect(() => {
		if (!import.meta.env.PROD) return;
		const gtag = (window as any).gtag;
		if (typeof gtag !== "function") return;

		const sendPageView = (location: {
			href: string;
			publicHref?: string;
			pathname: string;
			search: string;
			hash: string;
		}) => {
			const publicPath =
				location.publicHref ??
				`${location.pathname}${location.search}${location.hash}`;

			gtag("event", "page_view", {
				page_location: new URL(publicPath, window.location.origin).href,
				page_path: publicPath,
				page_title: document.title,
			});
		};

		sendPageView(history.location);
		const unsubscribe = history.subscribe(({ location }) => {
			sendPageView(location);
		});

		return () => {
			unsubscribe();
		};
	}, [history]);

	return null;
}

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(structuredData),
					}}
				/>
			</head>
			<body>
				{children}
				<PostHogAnalytics />
				<GoogleAnalyticsPageViews />
				<Scripts />
			</body>
		</html>
	);
}
