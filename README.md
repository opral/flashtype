# Flashtype

### The markdown editor for Claude & Codex

Agents edit. You review the diff. Nothing lands without you.

[Download for macOS](https://flashtype.ai) - [Website](https://flashtype.ai) - [Discord](https://discord.gg/gdMPPWy57R)

![Flashtype](https://flashtype.ai/og.png)

## Features

| Feature                 | Description                                      |
| ----------------------- | ------------------------------------------------ |
| Local files             | Edit `.md` and `.markdown` files directly.       |
| Claude & Codex          | Run agents next to the document.                 |
| Inline diffs            | Keep or undo edits with word-level context.      |
| History                 | Inspect checkpoints and restore earlier drafts.  |
| Markdown-native         | Keep portable markdown as the source of truth.   |

## Powered by Lix

Initialize a repository from History to keep future history after closing Flashtype.
Existing repositories are also checked against the size limit before native Lix
opening. After a crash during opening, the next launch shows recovery without
reopening the repository. The dev supervisor restarts once into this recovery
screen after a native crash.

If a persistent repository takes more than 30 seconds to open, Flashtype offers
**Delete .lix and restart**. Opening continues while the offer is visible. Choosing
it permanently removes that folder’s history, preserves its normal files, and
restarts all Flashtype windows. Deletion runs before repositories open in the new
process, so a stalled Lix open cannot block recovery. Nothing is deleted unless
the user chooses the action.

Initialization supports folders with up to **1 GB total**, with no file-count limit (including
subfolders, excluding Git and Lix metadata). Larger folders remain editable with
temporary history. History shows the limit check and lets you check again after
reducing the folder size.

<p>
  <a href="https://github.com/opral/lix">
    <img src="./website/public/lix-logo.svg" alt="Lix" width="64">
  </a>
</p>

Flashtype's version control features are powered by [Lix](https://github.com/opral/lix).

Lix is a version control system that can handle any file format, and is designed for building applications on top of.

## Download

Download Flashtype for macOS at [flashtype.ai](https://flashtype.ai).

## License

Flashtype is released under the [MIT License](./LICENSE).

## Local sync development

The development workspace uses published Lix SDK and filesystem storage v0.16.0
and Atelier through `submodule/atelier`. No sibling Lix checkout is required.
Both client and server must use the same server protocol version.

With the Lix reference server running at `http://127.0.0.1:8088`:

```sh
pnpm install
pnpm dev:sync --remote-debugging-port=9237
```

This creates a sample workspace at `.flashtype-dev/sync-workspace`, uploads its
repository with history using `createLix({ server, from: lix })`, and reopens
it with `openLix({ storage, server })`. The connection descriptor is saved in
`.flashtype-dev/sync-connections` and reused on subsequent launches.
The sync connection applies only to that exact workspace in development mode.

The default local server token is `flashtype-local-dev`. Override the target
with `FLASHTYPE_DEV_SYNC_SERVER`, `FLASHTYPE_DEV_SYNC_TOKEN`, and
`FLASHTYPE_DEV_SYNC_WORKSPACE`. Use a dedicated development server and workspace.
For a local-only preview, run `pnpm dev -- /path/to/folder` instead.

On machines whose default Python is older than 3.8, set `PYTHON` to a current
Python executable when running the development command; Electron's native
module rebuild invokes node-gyp.

The local setup used for this preview starts MinIO from the sibling Lixray
checkout and the Lix reference server from the source build:

```sh
docker compose -p flashtype-sync-dev -f ../lixray/compose.yml up -d minio minio-init
BIND_ADDR=127.0.0.1:8088 \
LIX_SERVER_PUBLIC_URL=http://127.0.0.1:8088 \
LIX_SERVER_INTERNAL_TOKEN=flashtype-local-dev \
S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=lixray \
S3_ACCESS_KEY_ID=lixray S3_SECRET_ACCESS_KEY=lixray-local-secret \
S3_REGION=us-east-1 S3_ALLOW_HTTP=true S3_PREFIX=flashtype-sync-final \
../lix-flashtype-dev/target/debug/lix-server
```

If using a shared `CARGO_TARGET_DIR`, use its `debug/lix-server` binary instead.
The currently verified preview uses `FLASHTYPE_DEV_SYNC_WORKSPACE=.flashtype-dev/sync-final`.
Keep the server's storage prefix stable when restarting so saved connection
descriptors continue to point to the same repositories.


## Sharing files with Lixray

Open a file and choose **Share**. Initialize the repository if history is
temporary. In [Lixray account settings](https://lixray.com/settings), generate an
API token and paste it into Flashtype. The token has your account's permissions.
Confirm **Sync privately and publish file**: Flashtype uploads the repository and
its history privately, then publishes only the selected file. Later synced edits
use the same public link. Share also supports copying the link and unpublishing.

The token is encrypted using the operating system's secure storage and kept in
Flashtype's user-data directory, outside `.lix`. There is no desktop OAuth flow.
Delete a token in Lixray account settings to revoke it; paste a replacement into
Share to reconnect. The saved connection is bound to the local `.lix` directory
identity and account, and resumes sync on reopen. An unavailable server leaves
the local workspace usable.

Interrupted initial uploads retain their snapshot and idempotency key so retries
send identical bytes. Publication waits until the selected file reaches the
server. This requires Lixray's creation gateway and account-token migration.
`FLASHTYPE_DEV_LIXRAY_ORIGIN` selects a local Lixray origin in development only.

Atelier owns Markdown, CSV, history, and review. Flashtype owns desktop integration
and Share. Its end-to-end Markdown fuzz test drives the normal Atelier UI;
isolated editor tests live in Atelier.
