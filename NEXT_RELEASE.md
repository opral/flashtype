---
type: patch
---

- Added Markdown link tools: select text and add, update, or remove links from the formatting toolbar. Typed `[label](url)` Markdown links are converted automatically, bare domains are normalized, email addresses become `mailto:` links, and relative links are preserved.
- Fixed clicking rendered Markdown links in the editor so external `http`, `https`, and `mailto` links open in the browser again.
- Improved agent review flow after Claude Code or Codex edits files: Flashtype now opens the first pending review file when an agent turn finishes and keeps the Files sidebar selection in sync with the active file.
- Added startup checks for supported Claude Code and Codex CLI versions, with clearer retryable messages when an agent command is missing, outdated, or cannot report its version.
