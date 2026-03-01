import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import { qb } from "@lix-js/kysely";
import { type Lix } from "@lix-js/sdk";
import {
	MarkdownWc,
	astToTiptapDoc,
	tiptapDocToAst,
} from "@opral/markdown-wc/tiptap";
import { parseMarkdown, normalizeAst, serializeAst } from "@opral/markdown-wc";
import { MARKDOWN_PLUGIN_KEY } from "@/lib/lix-plugin-keys";
import {
	MARKDOWN_V2_BLOCK_SCHEMA_KEY,
	MARKDOWN_V2_DOCUMENT_SCHEMA_KEY,
	MARKDOWN_V2_ROOT_ENTITY_ID,
	MARKDOWN_V2_SCHEMA_VERSION,
	type MarkdownV2BlockSnapshot,
	type MarkdownV2DocumentSnapshot,
} from "@/lib/markdown-v2-schema";
import { handlePaste as defaultHandlePaste } from "./handle-paste";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";

type CreateEditorArgs = {
	lix: Lix;
	initialMarkdown?: string;
	contentAst?: any;
	onCreate?: (args: { editor: Editor }) => void;
	onUpdate?: (args: { editor: Editor }) => void;
	editorProps?: any;
	fileId?: string;
	persistDebounceMs?: number;
	persistState?: boolean;
	writerKey?: string | null;
};

const cloneSnapshot = <T>(value: T): T =>
	typeof structuredClone === "function"
		? structuredClone(value)
		: (JSON.parse(JSON.stringify(value)) as T);

const canonicalizeSnapshot = <T>(value: T): T =>
	value == null ? value : normalizeAst(cloneSnapshot(value as any));

const parseSnapshotContent = <T>(value: unknown): T | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as T;
		} catch {
			return null;
		}
	}
	return value as T;
};

const snapshotFingerprint = (value: unknown): string => {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((entry) => snapshotFingerprint(entry)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${snapshotFingerprint(obj[key])}`)
		.join(",")}}`;
};

const createNodeId = (): string => {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(
		0,
		10,
	);
};

// Plain TipTap Editor factory (no React). Useful for unit/integration tests.
export function createEditor(args: CreateEditorArgs): Editor {
	const {
		lix,
		initialMarkdown,
		contentAst,
		onCreate,
		onUpdate,
		editorProps,
		fileId,
		persistDebounceMs,
		persistState = true,
		writerKey,
	} = args;

	const ast = contentAst ?? (parseMarkdown(initialMarkdown ?? "") as any);

	let persistStateTimer: any = null;
	// Serialize persist runs to avoid overlapping transactions causing inconsistent state snapshots.
	let persistRunning = false;
	let persistQueued = false;
	let currentEditor: Editor | null = null;
	const PERSIST_DEBOUNCE_MS = persistDebounceMs ?? 0;

	// Removed markdown file writes; state is the source of truth.

	function blockSnapshotFromNode(node: any): MarkdownV2BlockSnapshot {
		const normalizedNode = canonicalizeSnapshot(node) as Record<string, unknown>;
		const id = String((normalizedNode as any)?.data?.id ?? "");
		const type =
			typeof normalizedNode.type === "string" && normalizedNode.type.length > 0
				? normalizedNode.type
				: "paragraph";
		const markdown = serializeAst({
			type: "root",
			children: [normalizedNode],
		} as any);
		return {
			id,
			type,
			node: normalizedNode,
			markdown,
		};
	}

	async function upsertBlocks(trx: any, fileId: string, nodes: any[]) {
		for (const node of nodes) {
			const entityId = node.data.id as string;
			const snapshot = blockSnapshotFromNode(node);
			const normalizedFingerprint = snapshotFingerprint(snapshot);

			const existing = await trx
				.selectFrom("lix_state")
				.where("file_id", "=", fileId)
				.where("schema_key", "=", MARKDOWN_V2_BLOCK_SCHEMA_KEY)
				.where("entity_id", "=", entityId)
				.select(["entity_id", "snapshot_content"]) // small row
				.executeTakeFirst();

			if (existing) {
				const prevSnapshot = canonicalizeSnapshot(
					parseSnapshotContent(existing.snapshot_content),
				);
				if (snapshotFingerprint(prevSnapshot) === normalizedFingerprint) {
					continue;
				}
				await trx
					.updateTable("lix_state")
					.set({ snapshot_content: snapshot })
					.where("file_id", "=", fileId)
					.where("schema_key", "=", MARKDOWN_V2_BLOCK_SCHEMA_KEY)
					.where("entity_id", "=", entityId)
					.execute();
			} else {
				await trx
					.insertInto("lix_state")
					.values({
						entity_id: entityId,
						file_id: fileId,
						schema_key: MARKDOWN_V2_BLOCK_SCHEMA_KEY,
						schema_version: MARKDOWN_V2_SCHEMA_VERSION,
						plugin_key: MARKDOWN_PLUGIN_KEY,
						snapshot_content: snapshot,
					})
					.execute();
			}
		}
	}

	async function upsertRootOrder(trx: any, fileId: string, order: string[]) {
		const snapshotContent: MarkdownV2DocumentSnapshot = {
			id: MARKDOWN_V2_ROOT_ENTITY_ID,
			order,
		};
		const existingRoot = await trx
			.selectFrom("lix_state")
			.where("file_id", "=", fileId as any)
			.where("schema_key", "=", MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)
			.where("entity_id", "=", MARKDOWN_V2_ROOT_ENTITY_ID)
			.select(["entity_id", "snapshot_content"]) // small row
			.executeTakeFirst();

		if (existingRoot) {
			const parsedRoot = parseSnapshotContent<MarkdownV2DocumentSnapshot>(
				(existingRoot as any).snapshot_content,
			);
			const prevOrder = Array.isArray(parsedRoot?.order)
				? (parsedRoot.order as string[])
				: [];
			if (
				order.length === prevOrder.length &&
				order.every((value, index) => value === prevOrder[index])
			) {
				return;
			}
			await trx
				.updateTable("lix_state")
				.set({ snapshot_content: snapshotContent })
				.where("file_id", "=", fileId as any)
				.where("schema_key", "=", MARKDOWN_V2_DOCUMENT_SCHEMA_KEY)
				.where("entity_id", "=", MARKDOWN_V2_ROOT_ENTITY_ID)
				.execute();
		} else {
			await trx
				.insertInto("lix_state")
				.values({
					entity_id: MARKDOWN_V2_ROOT_ENTITY_ID,
					file_id: fileId as any,
					schema_key: MARKDOWN_V2_DOCUMENT_SCHEMA_KEY,
					schema_version: MARKDOWN_V2_SCHEMA_VERSION,
					plugin_key: MARKDOWN_PLUGIN_KEY,
					snapshot_content: snapshotContent,
				})
				.execute();
		}
	}

	/**
	 * Ensure each top-level block has a stable, unique data.id.
	 * - Assigns a new id if missing.
	 * - Regenerates ids for duplicates (e.g., paragraph split that cloned attrs).
	 */
	function ensureTopLevelIds(children: any[]): string[] {
		const order: string[] = [];
		const seen = new Set<string>();
		for (const node of children) {
			node.data = node.data || {};
			let id = (node.data.id ?? "") as string;
			if (!id || seen.has(id)) {
				do {
					id = createNodeId();
				} while (seen.has(id));
				node.data.id = id;
			}
			seen.add(id);
			order.push(id);
		}
		return order;
	}

	const placeholderConfig: any = {
		placeholder: ({ node }: { node: any }) =>
			node.type.name === "paragraph" && node.childCount === 0
				? "Start typing..."
				: "",
		showOnlyWhenEditable: true,
		includeChildren: true,
		shouldShow: ({ editor, node }: { editor: Editor; node: any }) =>
			editor.isFocused &&
			node.type.name === "paragraph" &&
			node.childCount === 0,
	};

	const markdownExtensions = MarkdownWc({}) as any[];

	return new Editor({
		extensions: [
			...markdownExtensions,
			History.configure({
				depth: 200,
				newGroupDelay: 500,
			}),
			Placeholder.configure(placeholderConfig),
			SlashCommandsExtension.configure({
				onStateChange: () => {},
			}),
			TableNavigationExtension,
		],
		content: astToTiptapDoc(ast) as any,
		onCreate: ({ editor }) => {
			currentEditor = editor as Editor;
			onCreate?.({ editor });
		},
		onUpdate: ({ editor }) => {
			onUpdate?.({ editor });
			if (!fileId || !persistState) return;
			// Debounce state writes using the provided debounce ms
			const ms = PERSIST_DEBOUNCE_MS;
			const run = async () => {
				if (persistRunning) {
					// Coalesce multiple rapid updates; run again after the current one finishes
					persistQueued = true;
					return;
				}
				persistRunning = true;
				const ast = tiptapDocToAst(editor.getJSON() as any);
				const children: any[] = Array.isArray((ast as any)?.children)
					? ((ast as any).children as any[])
					: [];
				const order = ensureTopLevelIds(children);
				try {
					await qb(lix, {
						writerKey: writerKey ?? `flashtype_tiptap_editor`,
					})
						.transaction()
						.execute(async (trx: any) => {
							await upsertBlocks(trx, fileId, children);
							await upsertRootOrder(trx, fileId, order);
							if (order.length > 0) {
								await trx
									.deleteFrom("lix_state")
									.where("file_id", "=", fileId as any)
									.where("plugin_key", "=", MARKDOWN_PLUGIN_KEY)
									.where("schema_key", "=", MARKDOWN_V2_BLOCK_SCHEMA_KEY)
									.where("entity_id", "not in", order as any)
									.execute();
							} else {
								await trx
									.deleteFrom("lix_state")
									.where("file_id", "=", fileId as any)
									.where("plugin_key", "=", MARKDOWN_PLUGIN_KEY)
									.where("schema_key", "=", MARKDOWN_V2_BLOCK_SCHEMA_KEY)
									.execute();
							}
						});
				} finally {
					persistRunning = false;
					if (persistQueued) {
						persistQueued = false;
						// Run again to capture the latest editor state
						await run();
					}
				}
			};
			if (ms <= 0) {
				void run();
			} else {
				if (persistStateTimer) clearTimeout(persistStateTimer);
				persistStateTimer = setTimeout(() => void run(), ms);
			}
		},
		editorProps: {
			handlePaste: async (_view: any, event: ClipboardEvent) => {
				if (!currentEditor) return false;
				return await defaultHandlePaste({
					editor: currentEditor as any,
					event,
				});
			},
			...editorProps,
		},
	});
}

// React useEditor config builder. TipTapEditor should use this to keep a single source.
