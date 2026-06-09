import { app } from "electron";
import path from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { openLix, SqliteBackend } from "@lix-js/sdk";

let lixPromise = null;
let lifecycle = Promise.resolve();

function enqueue(operation) {
	lifecycle = lifecycle.catch(() => {}).then(operation);
	return lifecycle;
}

function getLixFilename() {
	const testPath = process.env.FLASHTYPE_LIX_PATH?.trim();
	if (testPath) {
		return path.resolve(testPath);
	}
	return path.join(app.getPath("documents"), "lix", "main.lix");
}

function getLixStoragePaths() {
	const filename = getLixFilename();
	return [
		filename,
		`${filename}-wal`,
		`${filename}-shm`,
		`${filename}-journal`,
	];
}

export async function ensureLixOpen() {
	let outPromise;
	await enqueue(async () => {
		if (!lixPromise) {
			lixPromise = (async () => {
				const filename = getLixFilename();
				await mkdir(path.dirname(filename), { recursive: true });
				const nativeLix = await openLix({
					backend: new SqliteBackend({ path: filename }),
				});
				return createCompatLix(nativeLix, filename);
			})();
		}
		outPromise = lixPromise;
	});
	return await outPromise;
}

export async function closeLix() {
	await enqueue(async () => {
		if (!lixPromise) {
			return;
		}
		const currentPromise = lixPromise;
		try {
			const lix = await currentPromise;
			await lix.close();
		} finally {
			lixPromise = null;
		}
	});
}

export async function wipeLixStorage() {
	await closeLix();
	for (const pathToDelete of getLixStoragePaths()) {
		await rm(pathToDelete, { force: true });
	}
}

function createCompatLix(nativeLix, filename) {
	return {
		async execute(sql, params = []) {
			return await nativeLix.execute(rewriteCompatSql(sql), [...params]);
		},
		async beginTransaction() {
			const transaction = await nativeLix.beginTransaction();
			return {
				async execute(sql, params = []) {
					return await transaction.execute(rewriteCompatSql(sql), [...params]);
				},
				async commit() {
					await transaction.commit();
				},
				async rollback() {
					await transaction.rollback();
				},
			};
		},
		async executeTransaction(statements) {
			const transaction = await nativeLix.beginTransaction();
			let result = emptyExecuteResult();
			try {
				for (const statement of statements) {
					result = await transaction.execute(rewriteCompatSql(statement.sql), [
						...(statement.params ?? []),
					]);
				}
				await transaction.commit();
				return result;
			} catch (error) {
				await transaction.rollback();
				throw error;
			}
		},
		observe(query) {
			return createPollingObserve(nativeLix, query);
		},
		async createVersion(options = {}) {
			const created = await nativeLix.createBranch({
				id: options.id,
				name: options.name ?? "Draft",
			});
			return {
				id: created.id,
				name: created.name,
				inheritsFromVersionId: null,
			};
		},
		async switchVersion(versionId) {
			await nativeLix.switchBranch({ branchId: versionId });
		},
		async createCheckpoint() {
			const result = await nativeLix.execute(
				"SELECT lix_active_branch_commit_id() AS id",
			);
			const id = String(result.rows[0]?.get("id") ?? crypto.randomUUID());
			return { id, changeSetId: id };
		},
		async installPlugin({ archiveBytes }) {
			await nativeLix.execute(
				"INSERT INTO lix_file (path, data) VALUES ($1, $2)",
				["/.lix_system/plugins/plugin_md_v2.lixplugin", archiveBytes],
			);
		},
		async exportSnapshot() {
			return await readFile(filename);
		},
		async close() {
			await nativeLix.close();
		},
	};
}

function rewriteCompatSql(sql) {
	let out = String(sql);
	out = out.replace(/\bchange\s+as\s+/g, "lix_change as ");
	out = out.replace(
		/\b(from|join)\s+lix_active_version\b/gi,
		(_, keyword) => `${keyword} ${activeVersionSubquery()}`,
	);
	out = out.replace(/\blix_version\./g, "lix_branch.");
	out = out.replace(/\blix_version\b/g, "lix_branch");
	out = out.replace(
		/\blix_branch\.id\s*=\s*lix_active_version\.version_id\b/g,
		`lix_json('"' || lix_branch.id || '"') = lix_active_version.version_id`,
	);
	out = out.replace(
		/\blix_active_version\.version_id\s*=\s*lix_branch\.id\b/g,
		`lix_active_version.version_id = lix_json('"' || lix_branch.id || '"')`,
	);
	out = out.replace(
		/\blix_branch\.inherits_from_version_id\b/g,
		"NULL AS inherits_from_version_id",
	);
	out = out.replace(
		/(^|[\s,])inherits_from_version_id(?=([\s,]|$))/g,
		"$1NULL AS inherits_from_version_id",
	);
	out = out.replace(/\blixcol_version_id\b/g, "lixcol_branch_id");
	out = out.replace(/\blix_state_by_version\b/g, "lix_state_by_branch");
	out = out.replace(/\blix_file_by_version\b/g, "lix_file_by_branch");
	out = out.replace(/\blix_directory_by_version\b/g, "lix_directory_by_branch");
	out = out.replace(/\blix_key_value_by_version\b/g, "lix_key_value_by_branch");
	out = out.replace(
		/\blix_registered_schema_by_version\b/g,
		"lix_registered_schema_by_branch",
	);
	out = out.replace(
		/\blix_working_changes\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/g,
		`${emptyWorkingChangesSubquery()} as $1`,
	);
	out = out.replace(/\blix_working_changes\b/g, emptyWorkingChangesSubquery());
	return out;
}

function activeVersionSubquery() {
	return "(SELECT value AS version_id FROM lix_key_value WHERE key = 'lix_workspace_branch_id' LIMIT 1) AS lix_active_version";
}

function emptyWorkingChangesSubquery() {
	return "(SELECT NULL AS entity_pk, NULL AS schema_key, NULL AS file_id, NULL AS before_change_id, NULL AS after_change_id, NULL AS before_commit_id, NULL AS after_commit_id, 'unchanged' AS status WHERE false)";
}

function emptyExecuteResult() {
	return { columns: [], rows: [], rowsAffected: 0, notices: [] };
}

function createPollingObserve(nativeLix, query) {
	let closed = false;
	let polling = false;
	let previousKey;
	const pending = [];
	let timer;

	const poll = async () => {
		if (closed || polling) {
			return;
		}
		polling = true;
		try {
			const result = await nativeLix.execute(
				rewriteCompatSql(query?.sql ?? ""),
				[...(query?.params ?? [])],
			);
			const key = JSON.stringify(result.rows.map((row) => row.toObject()));
			if (previousKey !== undefined && key !== previousKey) {
				resolveNext({ sequence: Date.now(), rows: result });
			}
			previousKey = key;
		} catch (error) {
			rejectNext(error);
		} finally {
			polling = false;
		}
	};

	timer = setInterval(() => {
		void poll();
	}, 500);
	void poll();

	return {
		next() {
			if (closed) {
				return Promise.resolve(undefined);
			}
			return new Promise((resolve, reject) => {
				pending.push({ resolve, reject });
			});
		},
		close() {
			if (closed) {
				return;
			}
			closed = true;
			clearInterval(timer);
			while (pending.length > 0) {
				pending.shift()?.resolve(undefined);
			}
		},
	};

	function resolveNext(event) {
		const waiter = pending.shift();
		if (waiter) {
			waiter.resolve(event);
		}
	}

	function rejectNext(error) {
		const waiter = pending.shift();
		if (waiter) {
			waiter.reject(error);
		}
	}
}
