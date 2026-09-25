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

## Sharing

The **Share** button opens a teaser with a link to [Lixray](https://lixray.com).
To request syncing between Lixray and Flashtype, use the email link to
[samuel@opral.com](mailto:samuel@opral.com).
Flashtype opens repositories locally and does not upload, publish, or sync them.
