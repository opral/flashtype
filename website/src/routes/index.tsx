import { createFileRoute } from "@tanstack/react-router";

const GITHUB_URL = "https://github.com/opral/flashtype";
const DOWNLOAD_URL =
	"mailto:samuel@opral.com" +
	"?subject=" +
	encodeURIComponent("Request early access for Flashtype") +
	"&body=" +
	encodeURIComponent("Hi, I want early access to Flashtype");

export const Route = createFileRoute("/")({
	component: LandingPage,
});

// Easy to maintain: add/remove/edit features here.
const FEATURES = [
	{
		title: "Opens your local markdown files",
		body: "Point Flashtype at any folder on your disk. It opens the .md files you already have, and your agents work on the exact same files. No imports, no sync, no copies.",
		demo: (
			<div className="w-full max-w-[15rem] font-mono text-[13px]">
				<p className="text-ink/40">~/Documents/notes</p>
				<ul className="mt-2.5 space-y-2 text-ink/70">
					{["AGENTS.md", "meeting-notes.md", "roadmap.md"].map((name) => (
						<li key={name} className="flex items-center gap-2">
							<FileIcon className="size-3.5 shrink-0 text-ink/35" />
							{name}
						</li>
					))}
				</ul>
			</div>
		),
	},
	{
		title: "Claude & Codex built in",
		body: "A real terminal lives next to your document. Run claude or codex against the file you're editing. No copy-paste round-trips between your editor and your agent.",
		demo: (
			<div className="w-full max-w-[15rem] space-y-2.5 font-mono text-sm text-ink/70">
				<p className="flex items-center gap-2">
					<span className="text-ink/35">%</span> claude
					<ClaudeLogo className="size-4 text-claude" />
				</p>
				<p className="flex items-center gap-2">
					<span className="text-ink/35">%</span> codex
					<CodexLogo className="size-4.5" />
				</p>
				<p className="flex items-center gap-2 text-ink/35">
					%
					<span className="inline-block h-[1.1em] w-[7px] bg-ink/25" />
				</p>
			</div>
		),
	},
	{
		title: "Diffs",
		body: "Every agent edit shows up as an inline diff with word-level precision. Accept or reject each change before it lands.",
		demo: (
			<div className="max-w-[16rem]">
				<p className="text-sm leading-[2] text-ink/75">
					The <Del>famous</Del> <Ins>celebrated</Ins> Golden Gate Bridge spans
					the bay as a <Del>very pretty</Del> <Ins>rust-colored</Ins> marvel.
				</p>
			</div>
		),
	},
	{
		title: "Version history",
		body: (
			<>
				Every change is a checkpoint, powered by{" "}
				<a
					href="https://lix.dev"
					className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
				>
					Lix
				</a>
				. Browse the history of a document, see exactly what changed and by
				whom, and restore any earlier version.
			</>
		),
		demo: (
			<div className="w-full max-w-[16rem]">
				<ul className="space-y-0">
					{[
						{
							label: "Tighten the intro",
							meta: "Claude · just now",
							current: true,
						},
						{
							label: "Add one perfect day",
							meta: "you · 2h ago",
							current: false,
						},
						{
							label: "Initial draft",
							meta: "you · yesterday",
							current: false,
						},
					].map((checkpoint, i, all) => (
						<li key={checkpoint.label} className="flex gap-3">
							<div className="flex flex-col items-center">
								<span
									className={`mt-1 size-2.5 shrink-0 rounded-full ${
										checkpoint.current
											? "bg-flash"
											: "border border-ink/25 bg-white"
									}`}
								/>
								{i < all.length - 1 && (
									<span className="mt-1 w-px flex-1 bg-ink/15" />
								)}
							</div>
							<div className={i < all.length - 1 ? "pb-5" : ""}>
								<p
									className={`text-sm leading-tight ${
										checkpoint.current
											? "font-semibold text-ink"
											: "text-ink/70"
									}`}
								>
									{checkpoint.label}
								</p>
								<p className="mt-1 font-mono text-[11px] text-ink/40">
									{checkpoint.meta}
								</p>
							</div>
						</li>
					))}
				</ul>
			</div>
		),
	},
];

function LandingPage() {
	return (
		<div className="relative min-h-screen overflow-x-clip">
			<HeroGlow />
			<section>
				<Nav />
				<Hero />
				<AppMockup />
			</section>
			<main>
				<p className="mt-6 text-center font-mono text-xs text-ink/40">
					agents edit · you review · nothing lands without you
				</p>
				<Features />
				<OpenSource />
			</main>
			<Footer />
		</div>
	);
}

/* ---------------------------------- icons --------------------------------- */

function Bolt({ className = "size-5" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} fill="currentColor">
			<path d="M13 2 3.6 13.6h6.2L8.6 22l9.8-12.4h-6.3L13 2z" />
		</svg>
	);
}

// Official Claude mark (Anthropic), fill follows currentColor.
function ClaudeLogo({ className = "size-4" }: { className?: string }) {
	return (
		<svg viewBox="0 0 256 257" className={className} fill="currentColor" aria-hidden>
			<path d="m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z" />
		</svg>
	);
}

// Official OpenAI Codex mark (cloud with terminal prompt).
function CodexLogo({ className = "size-4" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} aria-hidden>
			<path
				d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z"
				fill="url(#codex-grad)"
			/>
			<defs>
				<linearGradient
					id="codex-grad"
					gradientUnits="userSpaceOnUse"
					x1="12"
					x2="12"
					y1="3"
					y2="21"
				>
					<stop stopColor="#B1A7FF" />
					<stop offset=".5" stopColor="#7A9DFF" />
					<stop offset="1" stopColor="#3941FF" />
				</linearGradient>
			</defs>
		</svg>
	);
}

function FileIcon({ className = "size-3.5" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
		>
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 2v6h6" />
		</svg>
	);
}

function GitHubMark({ className = "size-4" }: { className?: string }) {
	return (
		<svg viewBox="0 0 16 16" className={className} fill="currentColor">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}

function Star({ className = "size-3.5" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} fill="currentColor">
			<path d="M12 2l2.9 6.26L21.5 9.2l-4.75 4.4 1.25 6.65L12 17.1l-6 3.15 1.25-6.65L2.5 9.2l6.6-.94L12 2z" />
		</svg>
	);
}

function Download({ className = "size-4" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<path d="M7 10l5 5 5-5" />
			<path d="M12 15V3" />
		</svg>
	);
}

/* --------------------------------- layout --------------------------------- */

function HeroGlow() {
	return (
		<div
			aria-hidden
			className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-svh"
			style={{
				background:
					"radial-gradient(110% 80% at 50% 0%, #ffceaa 0%, #ffe3cb 38%, #fdf1e3 62%, transparent 88%)",
			}}
		/>
	);
}

function Nav() {
	return (
		<header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
			<a href="/" className="flex items-center gap-1.5 font-semibold">
				<Bolt className="size-5 text-flash" />
				Flashtype
			</a>
			<nav className="flex items-center gap-2.5 text-sm">
				<a
					href={GITHUB_URL}
					className="flex items-center gap-2 rounded-full border border-ink/15 bg-white/60 px-3.5 py-1.5 font-medium backdrop-blur transition-colors hover:bg-white"
				>
					<GitHubMark />
					GitHub
				</a>
				<a
					href={DOWNLOAD_URL}
					className="hidden items-center gap-2 rounded-full bg-ink px-4 py-1.5 font-medium text-paper transition-opacity hover:opacity-85 sm:flex"
				>
					<Download className="size-3.5" />
					Download for macOS
				</a>
			</nav>
		</header>
	);
}

function Hero() {
	return (
		<div className="mx-auto flex max-w-4xl flex-col items-center px-5 pt-4 pb-12 text-center sm:pt-6">
			<h1 className="text-[2.7rem] leading-[1.04] font-extrabold tracking-[-0.035em] text-balance sm:text-6xl md:text-7xl">
				The markdown editor for{" "}
				<span className="whitespace-nowrap">
					<ClaudeLogo className="inline size-[0.7em] align-[-0.05em] text-claude" />{" "}
					Claude
				</span>{" "}
				&amp;{" "}
				<span className="whitespace-nowrap">
					<CodexLogo className="inline size-[0.78em] align-[-0.1em]" /> Codex
				</span>
			</h1>

			<p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink/60 text-pretty">
				A WYSIWYG editor with your coding agents built in. They write, you
				review the diff. Accept or reject every change before it lands.
			</p>

			<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
				<a
					href={DOWNLOAD_URL}
					className="flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper shadow-lg shadow-ink/10 transition-opacity hover:opacity-85"
				>
					<Download className="size-4" />
					Download for macOS
				</a>
				<a
					href={GITHUB_URL}
					className="flex items-center gap-2 rounded-full border border-ink/15 bg-white/60 px-6 py-3 text-sm font-semibold backdrop-blur transition-colors hover:bg-white"
				>
					<Star className="size-4 text-flash" />
					Star on GitHub
				</a>
			</div>
		</div>
	);
}

/* -------------------------------- mockup ---------------------------------- */

function Del({ children }: { children: string }) {
	return (
		<span className="rounded-[3px] bg-[#fbdcd5] px-0.5 text-[#b3402a] line-through decoration-[#b3402a]/60">
			{children}
		</span>
	);
}

function Ins({ children }: { children: string }) {
	return (
		<span className="rounded-[3px] bg-[#d9f2d0] px-0.5 text-[#2c6e2f]">
			{children}
		</span>
	);
}

function AppMockup() {
	return (
		<div className="mx-auto w-full max-w-7xl px-5">
			<div className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_40px_80px_-24px_rgba(120,60,20,0.25)] md:aspect-[3/2]">
				{/* title bar */}
				<div className="relative flex h-11 items-center border-b border-ink/5 bg-[#faf6f0] px-4">
					<div className="flex gap-2">
						<span className="size-3 rounded-full bg-[#f57067]" />
						<span className="size-3 rounded-full bg-[#f5bf4f]" />
						<span className="size-3 rounded-full bg-[#5fc454]" />
					</div>
					<div className="pointer-events-none absolute inset-x-16 flex items-center justify-center gap-1.5 text-xs text-ink/45">
						<Bolt className="size-3.5 shrink-0 text-flash" />
						<span className="font-semibold text-ink/70">Flashtype</span>
						<span className="hidden sm:inline">
							· san-francisco-blog-post.md
						</span>
					</div>
				</div>

				<div className="grid min-h-0 flex-1 md:grid-cols-[240px_1fr] lg:grid-cols-[240px_1fr_290px]">
					{/* sidebar */}
					<aside className="hidden border-r border-ink/5 p-3 md:block">
						<p className="px-2 pt-1 pb-2 font-mono text-[10px] tracking-[0.14em] text-ink/35">
							FILES
						</p>
						<ul className="space-y-0.5 text-[13px] text-ink/65">
							{[
								["AGENTS.md", false],
								["ferry-building-guide.md", false],
								["san-francisco-blog-post.md", true],
								["sf-photo-captions.md", false],
								["twitter-script.md", false],
								["writing-style.md", false],
							].map(([name, active]) => (
								<li
									key={name as string}
									className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
										active ? "bg-ink/[0.06] font-medium text-ink" : ""
									}`}
								>
									<FileIcon className="size-3.5 shrink-0 text-ink/35" />
									<span className="truncate whitespace-nowrap">{name}</span>
								</li>
							))}
						</ul>
					</aside>

					{/* editor */}
					<div className="overflow-hidden px-7 py-7 sm:px-10">
						<h2 className="text-[1.65rem] font-extrabold tracking-tight">
							San Francisco: City by the Bay
						</h2>
						<p className="mt-4 max-w-[34rem] text-[15px] leading-[1.85] text-ink/80">
							San Francisco <Del>stands</Del> <Ins>is distinguished</Ins> as
							one of America&rsquo;s most iconic <Del>cities,</Del>{" "}
							<Ins>metropolitan areas,</Ins> characterized by rolling hills
							that <Del>meet</Del> <Ins>converge</Ins> with the Pacific
							coastline. The <Del>famous</Del> <Ins>celebrated</Ins> Golden
							Gate Bridge spans the bay as a rust-colored architectural
							marvel.
						</p>

						<blockquote className="mt-6 max-w-[34rem] border-l-[3px] border-flash/50 pl-4 text-[15px] leading-[1.85] text-ink/55 italic">
							&ldquo;The coldest winter I ever spent was a summer in San
							Francisco.&rdquo;
						</blockquote>

						<h3 className="mt-7 text-lg font-bold tracking-tight">
							One perfect day
						</h3>
						<ul className="mt-3 max-w-[34rem] space-y-2 text-[15px] leading-[1.7] text-ink/80">
							{[
								<>Sunrise at Fort Point, fog permitting</>,
								<>
									Cable car over Nob Hill to the{" "}
									<Ins>Ferry Building farmers market</Ins>
								</>,
								<>Golden Gate Park until the light goes golden</>,
							].map((item, i) => (
								<li key={i} className="flex gap-3">
									<span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-ink/30" />
									<span>{item}</span>
								</li>
							))}
						</ul>

						<p className="mt-6 max-w-[34rem] text-[15px] leading-[1.85] text-ink/80">
							End the day in the Mission, where burritos are a load-bearing
							part of the city&rsquo;s identity.
							<span className="caret ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-flash" />
						</p>
					</div>

					{/* claude panel */}
					<aside className="hidden flex-col overflow-hidden border-l border-ink/5 bg-[#fbf8f3] p-4 font-mono text-xs leading-relaxed lg:flex">
						<p className="text-ink/50">% claude</p>
						<div className="relative mt-3 rounded-md border border-claude/50 px-3 pt-4 pb-3 text-center">
							<span className="absolute -top-2 left-3 bg-[#fbf8f3] px-1 text-[10px] text-claude">
								Claude Code
							</span>
							<p className="font-semibold text-ink/80">Welcome back Alec!</p>
							<ClaudeLogo className="mx-auto mt-2 size-5 text-claude" />
							<p className="mt-2 text-[10px] text-ink/40">
								Sonnet 4.6 · Claude API
								<br />
								~/Documents/flashtype
							</p>
						</div>
						<p className="mt-4">
							<span className="text-flash">&gt;</span>{" "}
							<span className="text-ink/75">
								tighten the intro and review diffs
							</span>
						</p>
						<p className="mt-3 text-ink/60">
							<span className="text-[#2c6e2f]">●</span> Read{" "}
							<span className="font-semibold text-ink/80">
								writing-style.md
							</span>
						</p>
						<p className="mt-2 text-ink/60">
							<span className="text-[#2c6e2f]">●</span> Edited{" "}
							<span className="font-semibold text-ink/80">
								san-francisco-blog-post.md
							</span>{" "}
							(8 changes)
						</p>
						<p className="mt-4 text-ink/70">
							Tightened the intro and swapped vague adjectives for concrete
							ones. The diffs are in your editor, accept or reject inline.
						</p>
						<p className="mt-4">
							<span className="text-flash">&gt;</span>{" "}
							<span className="inline-block h-[1.2em] w-[7px] translate-y-[3px] bg-ink/25" />
						</p>
						<p className="mt-auto pt-6 text-ink/35">
							esc to interrupt · tab to review
						</p>
					</aside>
				</div>

				{/* status bar */}
				<div className="flex h-8 shrink-0 items-center justify-between border-t border-ink/5 bg-[#faf6f0] px-4 font-mono text-[11px] text-ink/40">
					<span className="flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-[#5fc454]" />
						saved · main
					</span>
					<span>markdown · 214 words</span>
				</div>
			</div>
		</div>
	);
}

/* -------------------------------- features -------------------------------- */

function Features() {
	return (
		<section className="mx-auto max-w-4xl px-5 pt-24 pb-4">
			<div className="divide-y divide-ink/10 border-y border-ink/10">
				{FEATURES.map((feature, i) => (
					<div
						key={feature.title}
						className="grid items-center gap-8 py-12 md:grid-cols-2 md:gap-14"
					>
						<div>
							<p className="font-mono text-xs text-flash">
								{String(i + 1).padStart(2, "0")}
							</p>
							<h3 className="mt-2 text-xl font-bold tracking-tight">
								{feature.title}
							</h3>
							<p className="mt-2 leading-relaxed text-ink/60">
								{feature.body}
							</p>
						</div>
						<div className="flex min-h-48 items-center justify-center rounded-2xl border border-ink/8 bg-white p-8 shadow-sm">
							{feature.demo}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

/* ------------------------------- open source ------------------------------- */

function OpenSource() {
	return (
		<section className="mx-auto max-w-3xl px-5 py-24 text-center">
			<GitHubMark className="mx-auto size-8 text-ink/80" />
			<h2 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
				Free &amp; open source
			</h2>
			<p className="mx-auto mt-4 max-w-xl leading-relaxed text-ink/60">
				Flashtype is built in the open on top of{" "}
				<a
					href="https://lix.dev"
					className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
				>
					Lix
				</a>
				, an embeddable version control system that powers the diffs, history,
				and change proposals. Read the source, file issues, send a PR.
			</p>
			<div className="mx-auto mt-8 flex max-w-md items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 font-mono text-[13px] shadow-sm">
				<span className="truncate">
					<span className="text-ink/35">$</span> git clone{" "}
					<span className="text-flash">github.com/opral/flashtype</span>
				</span>
			</div>
			<a
				href={GITHUB_URL}
				className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition-opacity hover:opacity-85"
			>
				<Star className="size-4 text-[#f5bf4f]" />
				Star on GitHub
			</a>
		</section>
	);
}

function Footer() {
	return (
		<footer className="border-t border-ink/10">
			<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-ink/50">
				<p className="flex items-center gap-1.5">
					<Bolt className="size-4 text-flash" />
					<span className="font-semibold text-ink/80">Flashtype</span>
					<span className="ml-1">
						by{" "}
						<a href="https://opral.com" className="hover:text-ink">
							Opral
						</a>
					</span>
				</p>
				<nav className="flex items-center gap-5">
					<a href={GITHUB_URL} className="hover:text-ink">
						GitHub
					</a>
					<a href="https://lix.dev" className="hover:text-ink">
						Lix
					</a>
					<a href="https://discord.gg/gdMPPWy57R" className="hover:text-ink">
						Discord
					</a>
				</nav>
			</div>
		</footer>
	);
}
