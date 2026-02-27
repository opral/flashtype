import type { Lix } from "@lix-js/sdk";

// Raw-import seed markdown content via Vite
// eslint-disable-next-line import/no-unresolved
import whatIsLix from "./what-is-lix.md?raw";
// eslint-disable-next-line import/no-unresolved
import meetingNotes from "./meeting-notes.md?raw";
// eslint-disable-next-line import/no-unresolved
import changelog from "./changelog.md?raw";
// eslint-disable-next-line import/no-unresolved
import welcome from "./welcome.md?raw";
// eslint-disable-next-line import/no-unresolved
import agentsSeed from "./AGENTS.md?raw";
import { qb } from "@lix-js/kysely";

const encoder = new TextEncoder();

type SeedDoc = { path: string; content: string };

const SEED_DOCS: SeedDoc[] = [
	{ path: "/what-is-lix.md", content: whatIsLix },
	{ path: "/notes/meeting-notes.md", content: meetingNotes },
	{ path: "/docs/changelog.md", content: changelog },
	{ path: "/welcome.md", content: welcome },
];

export async function seedMarkdownFiles(lix: Lix): Promise<void> {
	await qb(lix)
		.transaction()
		.execute(async (trx) => {
			for (const doc of SEED_DOCS) {
				const exists = await trx
					.selectFrom("lix_file")
					.where("path", "=", doc.path)
					.select(["path"])
					.executeTakeFirst();

				const data = encoder.encode(doc.content);
				if (exists) {
					await trx
						.updateTable("lix_file")
						.set({ data })
						.where("path", "=", doc.path)
						.execute();
				} else {
					await trx.insertInto("lix_file").values({ path: doc.path, data }).execute();
				}
			}
		});
}

export async function ensureAgentsFile(lix: Lix): Promise<void> {
	await qb(lix)
		.transaction()
		.execute(async (trx) => {
			const exists = await trx
				.selectFrom("lix_file")
				.where("path", "=", "/AGENTS.md")
				.select(["path"])
				.executeTakeFirst();

			if (exists) return;

			const data = encoder.encode(agentsSeed);
			await trx
				.insertInto("lix_file")
				.values({ path: "/AGENTS.md", data })
				.execute();
		});
}

export async function seedStarterContent(lix: Lix): Promise<void> {
	const allSeedDocs = [{ path: "/AGENTS.md", content: agentsSeed }, ...SEED_DOCS];
	await qb(lix)
		.transaction()
		.execute(async (trx) => {
			for (const doc of allSeedDocs) {
				const exists = await trx
					.selectFrom("lix_file")
					.where("path", "=", doc.path)
					.select(["path"])
					.executeTakeFirst();

				if (exists) {
					if (doc.path === "/AGENTS.md") {
						continue;
					}
					await trx
						.updateTable("lix_file")
						.set({ data: encoder.encode(doc.content) })
						.where("path", "=", doc.path)
						.execute();
					continue;
				}

				await trx
					.insertInto("lix_file")
					.values({ path: doc.path, data: encoder.encode(doc.content) })
					.execute();
			}
		});
}
