export type MarkdownReviewDiff = {
	readonly beforeMarkdown: string;
	readonly afterMarkdown: string;
	readonly beforeBlocks?: readonly MarkdownBlockSnapshot[];
	readonly afterBlocks?: readonly MarkdownBlockSnapshot[];
};

export type MarkdownBlockSnapshot = {
	readonly id: string;
	readonly orderKey: string;
	readonly block: string;
};
