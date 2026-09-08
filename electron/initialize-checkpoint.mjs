/** Checkpoint repository metadata only; leave document changes for user review. */
export async function checkpointRepositoryMetadata(lix) {
	const metadataDiff = `SELECT row_ref FROM lix_diff('lix_file')
  WHERE coalesce(to_path, from_path) LIKE '/.lix/%'`;
	const pending = await lix.execute(metadataDiff);
	if (pending.rows.length === 0) return;
	const result = await lix.execute(
		`SELECT commit_id FROM lix_create_checkpoint(ARRAY(${metadataDiff}))`,
	);
	if (typeof result.rows[0]?.commit_id !== "string") {
		throw new Error(
			"Repository metadata checkpoint did not return a commit ID.",
		);
	}
}
