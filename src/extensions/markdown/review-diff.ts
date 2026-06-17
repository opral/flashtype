export type MarkdownReviewDiff = {
	readonly beforeMarkdown: string;
	readonly afterMarkdown: string;
	readonly beforeDepth?: number;
	readonly afterDepth?: number;
};
