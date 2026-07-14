---
type: minor
version: 0.9.0
---

- Added frontmatter support to the Markdown editor, so YAML metadata is preserved and can be edited alongside document content.
- Improved Markdown review diffs for lists, tables, formatting, links, media, and moved or repeated blocks, with less noisy change highlighting.
- Added per-change Keep and Undo controls, making it possible to accept or reject individual agent edits instead of reviewing an entire file at once.
- Rebuilt the workspace around Atelier, with more reliable file tabs, panel state, direct Markdown opening from Finder, and restoration of recently opened documents.
- Improved Claude Code and Codex integration: agent terminals open alongside the workspace, external file writes appear as reviewable diffs, and changed files are surfaced automatically when an agent turn finishes.
- Added a clearer first-run workspace experience with an Open Folder action, an automatic fallback for creating the first Markdown file, and sensible panel defaults for folders and directly opened files.
- Upgraded the embedded Atelier workspace and Lix engine to the latest stable releases, reducing installation and startup complexity while improving Markdown review behavior.
