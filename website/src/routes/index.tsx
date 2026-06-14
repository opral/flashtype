import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

const GITHUB_URL = "https://github.com/opral/flashtype";
const DOWNLOAD_URL = "https://github.com/opral/flashtype/releases";

export const Route = createFileRoute("/")({
	component: LandingPage,
});

const primaryButton =
	"inline-flex items-center justify-center gap-[9px] rounded-[14px] border border-transparent bg-[linear-gradient(180deg,#F97316_0%,#E8590C_100%)] font-bold leading-none text-white no-underline shadow-[0_12px_34px_rgba(232,89,12,0.4),inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:-translate-y-px hover:brightness-[1.06]";
const secondaryButton =
	"inline-flex items-center justify-center gap-[9px] rounded-[14px] border border-[rgba(28,25,23,0.14)] bg-white/75 font-bold leading-none text-ink no-underline transition hover:-translate-y-px hover:border-[rgba(28,25,23,0.22)] hover:bg-white";
const miniDocument =
	"min-w-0 p-[30px_34px] leading-[1.7] text-body [&_a]:text-[#C2410C] [&_a]:underline [&_a]:underline-offset-[3px] [&_code]:mt-[18px] [&_code]:block [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-muted [&_h4]:m-0 [&_h4]:mb-[14px] [&_h4]:text-[24px] [&_h4]:font-bold [&_h4]:leading-[1.16] [&_h4]:tracking-normal [&_h4]:text-ink [&_h5]:m-0 [&_h5]:mt-[26px] [&_h5]:mb-[12px] [&_h5]:text-[21px] [&_h5]:font-bold [&_h5]:tracking-normal [&_h5]:text-ink [&_p]:m-0 [&_p]:text-[15.5px] [&_p]:leading-[1.7]";

const FEATURE_ROWS = [
	{
		title: (
			<>
				Open local
				<br />
				markdown files
			</>
		),
		body: "Point Flashtype at any folder on your disk - your notes, docs, or a repo. Every document is a plain .md file. No sync service, no proprietary format, no lock-in.",
		visual: <FilesVisual />,
		glow: "left-[-8%] top-[-10%]",
	},
	{
		title: "Rich text editing",
		body: "Headings, lists and links render live as you type - no split preview, no markdown syntax in your face. It reads like the finished page while you write.",
		visual: <EditorVisual />,
		glow: "right-[-6%] top-[-12%]",
	},
	{
		title: (
			<>
				<span className="inline-flex items-center gap-[10px]">
					<img src="/claude-icon.png" alt="" aria-hidden="true" className="h-[40px] w-[40px] object-contain max-md:h-[30px] max-md:w-[30px]" />
					Claude
				</span>{" "}
				&amp;{" "}
				<span className="inline-flex items-center gap-[10px]">
					<img src="/codex-icon.png" alt="" aria-hidden="true" className="h-[42px] w-[42px] object-contain max-md:h-[31px] max-md:w-[31px]" />
					Codex
				</span>
				<br />
				built in
			</>
		),
		body: "Run Claude Code or Codex in a pane next to your draft. They read and edit the same files - no copy-paste, no context juggling.",
		visual: <AgentsVisual />,
		glow: "bottom-[-16%] left-[-8%]",
	},
	{
		title: "Diffs",
		body: "Agent changes land as inline diffs right in your document. Accept the good ones, reject the rest - nothing changes without you seeing it.",
		visual: <DiffsVisual />,
		glow: "bottom-[-16%] right-[-6%]",
	},
	{
		title: "Version history",
		body: "Every change is checkpointed automatically. Browse a document's full history and restore any earlier version in one click - yours or the agent's.",
		visual: <HistoryVisual />,
		glow: "left-[-8%] top-[-10%]",
	},
] satisfies Array<{
	title: ReactNode;
	body: string;
	visual: ReactNode;
	glow: string;
}>;

function LandingPage() {
	return (
		<div className="min-h-screen overflow-x-clip bg-paper text-ink">
			<section className="relative overflow-hidden bg-[linear-gradient(180deg,#FFD9BC_0%,#FFE3CC_26%,#FFF1E5_56%,#FBF6F0_82%)]">
				<div className="pointer-events-none absolute left-[-220px] top-[-200px] h-[560px] w-[760px] rounded-full bg-[#F4945E] opacity-30 blur-[120px]" />
				<div className="pointer-events-none absolute right-[-200px] top-[-140px] h-[520px] w-[700px] rounded-full bg-[#FFC07A] opacity-[0.38] blur-[120px]" />
				<Nav />
				<Hero />
				<AppMockup />
			</section>
			<main className="relative bg-paper">
				<Features />
				<UseCasesAndFaq />
				<ClosingCta />
			</main>
			<Footer />
		</div>
	);
}

function Nav() {
	return (
		<header className="relative z-[2] mx-auto flex max-w-[1280px] items-center justify-between px-[40px] pt-[26px] max-sm:px-[22px] max-sm:pt-[22px]">
			<a
				href="/"
				className="flex items-center gap-[9px] text-[19px] font-bold tracking-normal text-ink no-underline"
				aria-label="Flashtype home"
			>
				<Bolt className="h-[22px] w-[22px] fill-flash text-flash" />
				<span>Flashtype</span>
			</a>
			<nav className="flex items-center gap-[22px] max-sm:gap-[14px]" aria-label="Primary navigation">
				<a href={GITHUB_URL} className="text-[15px] font-semibold text-[#44403C] no-underline max-sm:text-[14px]">
					GitHub ↗
				</a>
				<a
					href={DOWNLOAD_URL}
					className={`${primaryButton} rounded-[10px] px-[20px] py-[10px] text-[15px] shadow-[0_4px_14px_rgba(232,89,12,0.35),inset_0_1px_0_rgba(255,255,255,0.25)] max-sm:hidden`}
				>
					Download
				</a>
			</nav>
		</header>
	);
}

function Hero() {
	return (
		<div className="relative z-[2] flex flex-col items-center gap-[26px] px-[40px] pt-[80px] text-center max-md:px-[22px] max-md:pt-[64px]">
			<h1 className="m-0 max-w-[980px] text-[clamp(44px,7.2vw,70px)] font-bold leading-[1.08] tracking-normal text-ink max-md:text-[44px] max-md:leading-[1.1] max-[470px]:text-[39px]">
				The markdown editor
				<br />
				for{" "}
				<img
					src="/claude-icon.png"
					alt=""
					aria-hidden="true"
					className="ml-[4px] mr-[10px] inline-block h-[52px] w-[52px] object-contain align-[-5px] max-md:h-[34px] max-md:w-[34px]"
				/>
				Claude &amp;{" "}
				<img
					src="/codex-icon.png"
					alt=""
					aria-hidden="true"
					className="ml-[4px] mr-[10px] inline-block h-[54px] w-[54px] object-contain align-[-6px] max-md:h-[34px] max-md:w-[34px] max-md:align-[-5px]"
				/>
				Codex
			</h1>
			<p className="m-0 max-w-[600px] text-[21px] leading-[1.55] text-secondary [text-wrap:pretty] max-md:text-[18px]">
				A free, open-source editor for your local markdown files - with Claude
				Code and Codex built in. Write like a doc, review agent edits as diffs.
			</p>
			<div className="mt-[8px] flex flex-wrap items-center justify-center gap-[14px]">
				<a href={DOWNLOAD_URL} className={`${primaryButton} px-[34px] py-[18px] text-[18px] max-md:w-[min(100%,320px)] max-md:px-[24px] max-md:py-[16px] max-md:text-[16px]`}>
					Download for Mac
					<DownloadIcon />
				</a>
				<a href={GITHUB_URL} className={`${secondaryButton} px-[34px] py-[18px] text-[18px] max-md:w-[min(100%,320px)] max-md:px-[24px] max-md:py-[16px] max-md:text-[16px]`}>
					<span className="text-flash-bright">★</span>
					Star on GitHub
				</a>
			</div>
			<div className="text-[14px] text-muted">Free &amp; open source · macOS</div>
		</div>
	);
}

function AppMockup() {
	return (
		<div className="relative z-[2] mx-auto mt-[68px] mb-[40px] h-[min(880px,72vw)] min-h-[520px] w-[1400px] max-w-[calc(100%-48px)] max-xl:h-[620px] max-xl:min-h-0 max-md:mt-[48px] max-md:h-[420px] max-md:max-w-[calc(100%-24px)] max-[470px]:h-[340px]">
			<MockWindow
				className="absolute left-1/2 top-0 h-[940px] w-[1500px] origin-top -translate-x-1/2 scale-[0.82] rounded-[18px] border-white/95 shadow-[0_40px_110px_rgba(150,70,20,0.28)] max-xl:scale-[0.68] max-md:scale-[0.45] max-[470px]:scale-[0.36]"
				title="Flashtype - san-francisco-blog-post.md"
				hero
			>
				<div className="grid min-h-0 flex-1 grid-cols-[264px_minmax(0,1.45fr)_minmax(340px,1fr)]">
					<FileSidebar />
					<DocumentPane />
					<TerminalPane />
				</div>
			</MockWindow>
		</div>
	);
}

function Features() {
	return (
		<section className="mx-auto flex max-w-[1240px] flex-col gap-[140px] px-[40px] pt-[40px] max-md:gap-[90px] max-md:px-[22px] max-md:pt-[30px]">
			<h2 className="sr-only">Flashtype features</h2>
			{FEATURE_ROWS.map((feature) => (
				<article
					className="grid grid-cols-[1fr_1.12fr] items-center gap-[84px] max-xl:grid-cols-1 max-xl:gap-[36px]"
					key={String(feature.body)}
				>
					<div className="flex flex-col gap-[22px]">
						<h3 className="m-0 text-[44px] font-bold leading-[1.1] tracking-normal text-ink max-md:text-[34px]">
							{feature.title}
						</h3>
						<p className="m-0 max-w-[440px] text-[18px] leading-[1.6] text-secondary [text-wrap:pretty] max-xl:max-w-[720px] max-md:text-[17px]">
							{feature.body}
						</p>
					</div>
					<div className="relative h-[440px] overflow-hidden rounded-[20px] bg-panel shadow-[inset_0_0_0_1px_rgba(28,25,23,0.05)] max-md:h-[360px] max-md:rounded-[18px] max-[470px]:mr-[-22px] max-[470px]:h-[310px] max-[470px]:rounded-r-none">
						<div className="absolute inset-0 bg-[radial-gradient(circle,rgba(249,115,22,0.16)_1px,transparent_1.4px)] bg-[length:15px_15px] opacity-50" />
						<div className={`absolute h-[420px] w-[520px] rounded-full bg-flash-bright opacity-10 blur-[120px] ${feature.glow}`} />
						{feature.visual}
					</div>
				</article>
			))}
		</section>
	);
}

function FilesVisual() {
	return (
		<FeatureWindow title="blog">
			<div className="grid min-h-0 flex-1 grid-cols-[250px_minmax(0,1fr)]">
				<aside className="min-w-0 border-r border-chrome bg-soft-surface p-[14px_10px]">
					<FileLine kind="folder">drafts</FileLine>
					<FileLine kind="file" active nested>
						san-francisco.md
					</FileLine>
					<FileLine kind="folder">published</FileLine>
					<FileLine kind="file">AGENTS.md</FileLine>
					<FileLine kind="file">writing-style.md</FileLine>
				</aside>
				<div className={miniDocument}>
					<h4>San Francisco: City by the Bay</h4>
					<p>
						One of America&apos;s most iconic cities, characterized by rolling
						hills that meet the Pacific coastline.
					</p>
					<code>~/Documents/blog/drafts</code>
				</div>
			</div>
		</FeatureWindow>
	);
}

function EditorVisual() {
	return (
		<FeatureWindow title="san-francisco.md">
			<FormattingToolbar />
			<div className={`${miniDocument} p-[26px_40px_34px] [&_h4]:mb-[18px] [&_h4]:text-[30px] [&_p]:text-[17px]`}>
				<h4>San Francisco: City by the Bay</h4>
				<p>
					One of America&apos;s most iconic cities, characterized by rolling hills
					that meet the Pacific coastline. The{" "}
					<span className="text-[#C2410C] underline underline-offset-[3px]">Golden Gate Bridge</span>{" "}
					spans the bay as a
					rust-colored marvel.
				</p>
				<table className="mt-[24px] w-full max-w-[480px] border-separate border-spacing-0 overflow-hidden rounded-[10px] border border-chrome text-left text-[14px] leading-[1.35]">
					<thead className="bg-[#F4EEE6] text-[12px] uppercase tracking-[0.08em] text-[#7C2D12]">
						<tr>
							<th className="border-b border-[#EAD9C8] px-[14px] py-[10px] font-bold">Neighborhood</th>
							<th className="border-b border-[#EAD9C8] px-[14px] py-[10px] font-bold">Weather</th>
							<th className="border-b border-[#EAD9C8] px-[14px] py-[10px] font-bold">Bring</th>
						</tr>
					</thead>
					<tbody className="text-secondary">
						<tr>
							<td className="border-b border-chrome px-[14px] py-[11px] font-semibold text-ink">Sunset</td>
							<td className="border-b border-chrome px-[14px] py-[11px]">Foggy</td>
							<td className="border-b border-chrome px-[14px] py-[11px]">Jacket</td>
						</tr>
						<tr>
							<td className="px-[14px] py-[11px] font-semibold text-ink">Mission</td>
							<td className="px-[14px] py-[11px]">Sunny</td>
							<td className="px-[14px] py-[11px]">
								Sunglasses<span className="ml-[2px] inline-block h-[16px] w-[2px] animate-[caret-blink_1.1s_steps(1)_infinite] bg-[#C2410C] align-[-3px]" />
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</FeatureWindow>
	);
}

function FormattingToolbar() {
	return (
		<div className="flex h-[48px] shrink-0 items-center gap-[7px] border-b border-chrome bg-[#FCFBFA] px-[28px] text-[13px] text-muted">
			<ToolbarButton active>H1</ToolbarButton>
			<ToolbarButton>H2</ToolbarButton>
			<div className="mx-[4px] h-[20px] w-px bg-chrome" />
			<ToolbarButton strong>B</ToolbarButton>
			<ToolbarButton italic>I</ToolbarButton>
			<ToolbarButton>U</ToolbarButton>
			<div className="mx-[4px] h-[20px] w-px bg-chrome" />
			<ToolbarButton>Link</ToolbarButton>
			<ToolbarButton>• List</ToolbarButton>
		</div>
	);
}

function ToolbarButton({
	children,
	active = false,
	strong = false,
	italic = false,
}: {
	children: ReactNode;
	active?: boolean;
	strong?: boolean;
	italic?: boolean;
}) {
	return (
		<span
			className={`inline-flex h-[28px] min-w-[30px] items-center justify-center rounded-[7px] px-[9px] ${active ? "bg-[#F4EEE6] text-[#C2410C] shadow-[inset_0_0_0_1px_#EAD9C8]" : "text-muted"} ${strong ? "font-bold text-ink" : "font-semibold"} ${italic ? "italic" : ""}`}
		>
			{children}
		</span>
	);
}

function AgentsVisual() {
	return (
		<FeatureWindow title="san-francisco.md">
			<div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
				<aside className="flex min-w-0 flex-col border-r border-chrome bg-soft-surface p-[22px] font-mono text-[13px] leading-[1.7] text-secondary [&_p]:mt-[12px] [&_strong]:text-ink">
					<div className="mb-[14px] flex items-center gap-[7px] font-semibold text-[#44403C]">
						<img src="/claude-icon.png" alt="" className="h-[15px] w-[15px]" />
						Claude Code
					</div>
					<div className="rounded-[8px] border border-dashed border-terminal/80 bg-white/70 px-[14px] py-[13px] text-center shadow-[0_12px_30px_rgba(226,114,91,0.08)]">
						<div className="text-[12px] font-semibold text-terminal">
							Claude Code <span className="text-muted">terminal</span>
						</div>
						<div className="mt-[10px] text-[12.5px] font-semibold text-ink">
							Ready to edit
						</div>
						<ClaudeCodeMascot compact />
						<div className="mt-[9px] text-[11.5px] leading-[1.45] text-faint">
							Agent session · local project
							<br />
							~/Documents/flashtype
						</div>
					</div>
					<p className="text-ink">
						<span className="text-terminal">&gt;</span> tighten the intro and add a section
					</p>
					<p>⏺ Edited <strong>san-francisco.md</strong></p>
					<small className="mt-[4px] text-muted">+8 -12 · 2 sections</small>
					<p className="text-ink">
						<span className="text-terminal">&gt;</span> fix the headline too
					</p>
					<p>⏺ Working...</p>
					<div className="mt-auto rounded-[8px] border border-chrome p-[11px_13px] text-[12.5px] text-muted">
						<span className="text-terminal">&gt;</span> Type a task...
					</div>
				</aside>
				<div className={`${miniDocument} p-[28px_30px]`}>
					<h4>City by the Bay</h4>
					<p>
						Rolling hills meet the Pacific coastline, and the Golden Gate Bridge
						spans the bay.
					</p>
				</div>
			</div>
		</FeatureWindow>
	);
}

function DiffsVisual() {
	return (
		<FeatureWindow title="san-francisco.md">
			<div className={`${miniDocument} p-[34px_40px] [&_p]:text-[17px] [&_p]:leading-[1.85]`}>
				<p>
					San Francisco <Del>stands</Del> <Ins>is distinguished</Ins> as one of
					America&apos;s most iconic <Del>cities,</Del>{" "}
					<Ins>metropolitan areas,</Ins> characterized by rolling hills that
					converge with the Pacific coastline.
				</p>
				<div className="mt-[24px] flex items-center gap-[9px]">
					<button type="button" className="rounded-[8px] border-0 bg-flash-bright px-[16px] py-[8px] text-[13px] font-bold text-white">
						Accept all
					</button>
					<button type="button" className="rounded-[8px] border border-[#E5E0D8] bg-white px-[16px] py-[8px] text-[13px] font-bold text-[#44403C]">
						Reject
					</button>
					<span className="ml-[4px] text-[12.5px] text-muted">3 edits from Claude</span>
				</div>
			</div>
		</FeatureWindow>
	);
}

function HistoryVisual() {
	return (
		<FeatureWindow title="san-francisco.md">
			<div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)]">
				<aside className="min-w-0 border-r border-chrome bg-soft-surface p-[18px_16px]">
					<div className="mb-[16px] font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-faint">
						Version History
					</div>
					<div className="relative flex flex-col gap-[2px] before:absolute before:bottom-[8px] before:left-[15px] before:top-[8px] before:w-[1.5px] before:bg-[#EAE4DC]">
						<HistoryItem title="Current draft" meta="now · You" current />
						<HistoryItem
							title="Claude · tightened intro"
							meta="2m ago · +8 -12"
							selected
						/>
						<HistoryItem title="Added microclimates" meta="14m ago · +21" />
						<HistoryItem title="Created" meta="yesterday" />
					</div>
				</aside>
				<div className={`${miniDocument} p-[28px_30px]`}>
					<h4>City by the Bay</h4>
					<p>
						Rolling hills meet the Pacific coastline, and the Golden Gate Bridge
						spans the bay.
					</p>
				</div>
			</div>
		</FeatureWindow>
	);
}

function UseCasesAndFaq() {
	const faqs = [
		{
			question: "What is Flashtype?",
			answer:
				"Flashtype is a free, open-source macOS markdown editor with Claude Code and Codex built in.",
		},
		{
			question: "Does Flashtype work with local files?",
			answer:
				"Yes. Open any folder on disk and keep writing in plain .md files without a proprietary format.",
		},
		{
			question: "How are AI edits reviewed?",
			answer:
				"Claude Code and Codex can edit the same files, and Flashtype shows their changes as inline diffs before you accept or reject them.",
		},
	];

	return (
		<section className="mx-auto flex max-w-[820px] flex-col items-center px-[40px] pt-[150px] text-center max-md:px-[22px] max-md:pt-[105px]">
			<h2 className="m-0 text-[42px] font-bold leading-[1.1] tracking-normal text-ink max-md:text-[34px]">
				FAQ
			</h2>
			<div className="mt-[34px] grid w-full gap-[14px] text-left">
				{faqs.map((faq) => (
					<article
						className="rounded-[16px] border border-[rgba(28,25,23,0.08)] bg-white px-[24px] py-[22px] shadow-[0_20px_50px_rgba(150,70,20,0.08)]"
						key={faq.question}
					>
						<h3 className="m-0 text-[18px] font-bold tracking-normal text-ink">
							{faq.question}
						</h3>
						<p className="mt-[9px] mb-0 text-[16px] leading-[1.6] text-secondary">
							{faq.answer}
						</p>
					</article>
				))}
			</div>
		</section>
	);
}

function ClosingCta() {
	return (
		<section className="mx-auto flex max-w-[1240px] flex-col items-center gap-[22px] px-[40px] pt-[160px] text-center max-md:px-[22px] max-md:pt-[110px]">
			<Bolt className="h-[34px] w-[34px] fill-flash-bright text-flash-bright" />
			<h2 className="m-0 max-w-[600px] text-[46px] font-bold leading-[1.1] tracking-normal text-ink [text-wrap:balance] max-md:text-[34px]">
				Free &amp; open source
			</h2>
			<p className="m-0 max-w-[460px] text-[18px] leading-[1.6] text-muted [text-wrap:pretty]">
				Built in the open. Issues, pull requests and stars welcome.
			</p>
			<div className="mt-[8px] flex flex-wrap items-center justify-center gap-[14px]">
				<a href={DOWNLOAD_URL} className={`${primaryButton} px-[34px] py-[18px] text-[18px] max-md:w-[min(100%,320px)] max-md:px-[24px] max-md:py-[16px] max-md:text-[16px]`}>
					Download for Mac
					<DownloadIcon />
				</a>
				<a href={GITHUB_URL} className={`${secondaryButton} px-[34px] py-[18px] text-[18px] max-md:w-[min(100%,320px)] max-md:px-[24px] max-md:py-[16px] max-md:text-[16px]`}>
					<span className="text-flash-bright">★</span>
					Star on GitHub
				</a>
			</div>
			<div className="mt-[4px] font-mono text-[13px] text-muted">macOS · MIT license</div>
		</section>
	);
}

function Footer() {
	return (
		<footer className="bg-paper">
			<div className="mx-auto flex max-w-[1240px] items-center justify-between px-[40px] pt-[110px] pb-[56px] max-md:flex-col max-md:items-start max-md:px-[22px] max-md:pt-[80px] max-md:pb-[40px]">
				<a href="/" className="flex items-center gap-[8px] text-[14px] font-semibold text-faint no-underline" aria-label="Flashtype home">
					<Bolt className="h-[16px] w-[16px] fill-flash-bright text-flash-bright" />
					<span>Flashtype</span>
				</a>
				<nav className="flex items-center gap-[24px] text-[14px] text-muted max-md:flex-wrap max-md:gap-x-[20px] max-md:gap-y-[14px]" aria-label="Footer navigation">
					<a href={GITHUB_URL} className="no-underline hover:text-ink">GitHub</a>
					<a href={DOWNLOAD_URL} className="no-underline hover:text-ink">Download for Mac</a>
					<span>© 2026 Opral</span>
				</nav>
			</div>
		</footer>
	);
}

function FeatureWindow({ children, title }: { children: ReactNode; title: string }) {
	return (
		<MockWindow
			className="absolute left-[52px] top-[46px] h-[470px] w-[680px] rounded-[13px] max-xl:left-[40px] max-md:left-[24px] max-md:top-[36px] max-md:origin-top-left max-md:scale-[0.78] max-[470px]:left-[18px] max-[470px]:top-[30px] max-[470px]:scale-[0.66]"
			title={title}
		>
			{children}
		</MockWindow>
	);
}

function MockWindow({
	children,
	className,
	title,
	hero = false,
}: {
	children: ReactNode;
	className?: string;
	title: string;
	hero?: boolean;
}) {
	return (
		<div
			aria-hidden="true"
			className={`flex flex-col overflow-hidden border border-[rgba(28,25,23,0.08)] bg-white shadow-[0_30px_70px_rgba(150,70,20,0.2)] ${className ?? ""}`}
		>
			<div className={`relative flex shrink-0 items-center border-b border-chrome ${hero ? "h-[56px] px-[22px]" : "h-[44px] px-[16px]"}`}>
				<div className={`flex ${hero ? "gap-[10px]" : "gap-[8px]"}`} aria-hidden>
					<span className={`${hero ? "h-[15px] w-[15px]" : "h-[11px] w-[11px]"} rounded-full bg-[#FF5F57]`} />
					<span className={`${hero ? "h-[15px] w-[15px]" : "h-[11px] w-[11px]"} rounded-full bg-[#FEBC2E]`} />
					<span className={`${hero ? "h-[15px] w-[15px]" : "h-[11px] w-[11px]"} rounded-full bg-[#28C840]`} />
				</div>
				<div
					className={
						hero
							? "ml-[18px] flex items-center gap-[9px] text-[16.5px] text-faint"
							: "pointer-events-none absolute inset-0 flex items-center justify-center gap-[6px] text-[12.5px] font-semibold text-muted"
					}
				>
					<Bolt className={`${hero ? "h-[17px] w-[17px]" : "h-[12px] w-[12px]"} fill-flash text-flash`} />
					<span>{title}</span>
				</div>
			</div>
			{children}
		</div>
	);
}

function FileSidebar() {
	return (
		<aside className="border-r border-chrome bg-[#FCFCFB] p-[22px_14px]">
			<div className="px-[12px] pb-[10px] font-mono text-[14.5px] font-bold uppercase tracking-[0.12em] text-faint">
				Files
			</div>
			<FileLine kind="file" large>AGENTS.md</FileLine>
			<FileLine kind="file" active large>
				san-francisco-blog-post.md
			</FileLine>
			<FileLine kind="file" large>twitter-script.md</FileLine>
			<FileLine kind="file" large>writing-style.md</FileLine>
		</aside>
	);
}

function DocumentPane() {
	return (
		<div className="min-w-0 border-r border-chrome p-[44px_48px] leading-[1.7] text-body">
			<h2 className="m-0 mb-[20px] text-[36px] font-bold leading-[1.12] tracking-normal text-ink">
				San Francisco: City by the Bay
			</h2>
			<p className="m-0 text-[24px] leading-[1.7]">
				San Francisco <Del>stands</Del> <Ins>is distinguished</Ins> as one of
				America&apos;s most iconic <Del>cities,</Del>{" "}
				<Ins>metropolitan areas,</Ins> characterized by rolling hills that
				converge with the Pacific coastline. The celebrated Golden Gate Bridge
				spans the bay as a rust-colored architectural marvel.
			</p>
			<p className="mt-[28px] text-[24px] leading-[1.7]">
				Cable cars still climb toward Nob Hill while afternoon fog rolls through
				the Golden Gate, softening the skyline into watercolor.
			</p>
			<h3 className="mt-[32px] mb-[12px] text-[28px] font-bold tracking-normal text-ink">
				A city of microclimates
			</h3>
			<table className="mt-[18px] w-full max-w-[620px] border-separate border-spacing-0 overflow-hidden rounded-[12px] border border-chrome text-left text-[18px] leading-[1.35]">
				<thead className="bg-[#F4EEE6] text-[13px] uppercase tracking-[0.08em] text-[#7C2D12]">
					<tr>
						<th className="border-b border-[#EAD9C8] px-[18px] py-[12px] font-bold">Neighborhood</th>
						<th className="border-b border-[#EAD9C8] px-[18px] py-[12px] font-bold">Weather</th>
						<th className="border-b border-[#EAD9C8] px-[18px] py-[12px] font-bold">Bring</th>
					</tr>
				</thead>
				<tbody className="text-secondary">
					<tr>
						<td className="border-b border-chrome px-[18px] py-[14px] font-semibold text-ink">Sunset</td>
						<td className="border-b border-chrome px-[18px] py-[14px]">Foggy</td>
						<td className="border-b border-chrome px-[18px] py-[14px]">Jacket</td>
					</tr>
					<tr>
						<td className="px-[18px] py-[14px] font-semibold text-ink">Mission</td>
						<td className="px-[18px] py-[14px]">
							<Del>Sunny</Del> <Ins>Warm</Ins>
						</td>
						<td className="px-[18px] py-[14px]">
							Sunglasses
							<span className="ml-[2px] inline-block h-[22px] w-[3px] animate-[caret-blink_1.1s_steps(1)_infinite] bg-ink align-[-4px]" />
						</td>
					</tr>
				</tbody>
			</table>
		</div>
	);
}

function TerminalPane() {
	return (
		<aside className="flex min-w-0 flex-col bg-[#FCFCFB] p-[30px_36px_34px] font-mono text-[18px] leading-[1.6] text-[#44403C]">
			<p className="m-0 text-muted">% claude</p>
			<div className="relative mt-[16px] flex flex-col items-center gap-[12px] rounded-[5px] border border-terminal p-[22px_24px_20px] text-center">
				<span className="absolute left-[18px] top-[-12px] bg-[#FCFCFB] px-[8px] text-[16px] text-terminal">
					Claude Code
				</span>
				<strong className="text-ink">Ready to edit</strong>
				<ClaudeCodeMascot />
				<small className="text-[16px] leading-[1.5] text-faint">
					Agent session · local project
					<br />
					~/Documents/flashtype
				</small>
			</div>
			<p className="mt-[14px] text-secondary">
				<span className="text-terminal">&gt;</span> tighten the intro and review diffs
			</p>
			<p className="mt-[14px] text-secondary">⏺ Edited <strong className="text-ink">san-francisco-blog-post.md</strong> - 8 additions, 12 deletions</p>
			<p className="mt-[14px] text-secondary">⏺ Added section <strong className="text-ink">A city of microclimates</strong></p>
			<div className="mt-auto rounded-[9px] border border-[#E7E2DA] p-[16px_18px] text-faint">
				<span className="text-terminal">&gt;</span> Type a task for Claude...
			</div>
		</aside>
	);
}

const mascotPixels = [
	"..ooo..",
	".ooooo.",
	"ooeoeoo",
	".ooooo.",
	"..o.o..",
];

function ClaudeCodeMascot({ compact = false }: { compact?: boolean }) {
	return (
		<div
			className={`mx-auto grid grid-cols-7 ${compact ? "my-[8px]" : "my-[2px]"} drop-shadow-[0_6px_12px_rgba(226,114,91,0.18)]`}
			aria-hidden
		>
			{mascotPixels.flatMap((row, rowIndex) =>
				[...row].map((pixel, columnIndex) => (
					<span
						key={`${rowIndex}-${columnIndex}`}
						className={`${compact ? "h-[5px] w-[5px]" : "h-[10px] w-[10px]"} ${pixel === "." ? "opacity-0" : pixel === "e" ? "bg-ink" : "bg-terminal"}`}
					/>
				)),
			)}
		</div>
	);
}

function FileLine({
	children,
	kind,
	active = false,
	nested = false,
	large = false,
}: {
	children: ReactNode;
	kind: "file" | "folder";
	active?: boolean;
	nested?: boolean;
	large?: boolean;
}) {
	return (
		<div
			className={`flex items-center rounded-[7px] text-secondary ${large ? "gap-[10px] p-[10px_12px] text-[17px]" : "gap-[9px] p-[7px_11px] text-[14px]"} ${nested ? "pl-[28px]" : ""} ${active ? "bg-chrome font-semibold text-ink" : ""}`}
		>
			{kind === "folder" ? <FolderIcon active={active} /> : <FileIcon active={active} />}
			<span>{children}</span>
		</div>
	);
}

function HistoryItem({
	title,
	meta,
	current = false,
	selected = false,
}: {
	title: string;
	meta: string;
	current?: boolean;
	selected?: boolean;
}) {
	return (
		<div className={`relative flex gap-[12px] rounded-[9px] p-[9px_10px] ${selected ? "bg-[#F4EEE6]" : ""}`}>
			<span className={`z-[1] mt-[2px] h-[11px] w-[11px] shrink-0 rounded-full border-2 border-soft-surface ${current ? "bg-flash-bright" : "bg-[#C9C2B8]"}`} />
			<div>
				<strong className={`block text-[13.5px] leading-[1.2] ${current || selected ? "font-semibold text-ink" : "font-medium text-[#44403C]"}`}>
					{title}
				</strong>
				<small className="mt-[2px] block text-[11.5px] text-faint">{meta}</small>
				{selected && (
					<button type="button" className="mt-[8px] rounded-[7px] border border-[#EAD9C8] bg-transparent px-[11px] py-[5px] text-[11.5px] font-bold text-[#C2410C]">
						Restore this version
					</button>
				)}
			</div>
		</div>
	);
}

function Del({ children }: { children: ReactNode }) {
	return (
		<span className="rounded-[4px] bg-delete-bg px-[4px] text-delete-text line-through decoration-[rgba(220,38,38,0.55)]">
			{children}
		</span>
	);
}

function Ins({ children }: { children: ReactNode }) {
	return <span className="rounded-[4px] bg-insert-bg px-[4px] text-insert-text">{children}</span>;
}

function Bolt({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={className} aria-hidden>
			<path d="M13 2L4.5 13.5H11L9.5 22L19.5 9.5H12.5L13 2Z" />
		</svg>
	);
}

function DownloadIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
			<path
				d="M12 3v11m0 0L7.5 9.5M12 14l4.5-4.5M4.5 20h15"
				stroke="currentColor"
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function FileIcon({ active = false }: { active?: boolean }) {
	return (
		<svg viewBox="0 0 24 24" className={`h-[14px] w-[14px] shrink-0 fill-none ${active ? "stroke-[#C2410C]" : "stroke-muted"} stroke-2`} aria-hidden>
			<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
			<path d="M14 2v4a2 2 0 0 0 2 2h4" />
		</svg>
	);
}

function FolderIcon({ active = false }: { active?: boolean }) {
	return (
		<svg viewBox="0 0 24 24" className={`h-[14px] w-[14px] shrink-0 fill-none ${active ? "stroke-[#C2410C]" : "stroke-muted"} stroke-2`} aria-hidden>
			<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
		</svg>
	);
}
