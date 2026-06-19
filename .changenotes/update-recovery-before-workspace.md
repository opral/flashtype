---
type: patch
---

Improved update recovery when FlashType cannot finish opening the workspace UI.

FlashType now starts its updater before loading workspace-native modules, so a follow-up update can still be found and installed even if the main editing experience fails during startup.
