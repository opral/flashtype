# Changelog

## 0.3.0 - 2026-06-18

### Minor

- Improved Markdown review diffs so edits inside lists, tables, and other structured Markdown render with less noise.

  FlashType now uses Markdown-aware structure when showing review changes, making accepted and rejected edits easier to inspect before applying them.

### Patch

- Fixed deleted files staying open in the main editor.

  When a file is deleted from the file navigator, any open editor view for that file now closes instead of showing stale content.
- Fixed scrolling in the file navigator when a workspace contains many files.

  The file list now scrolls inside the navigator panel instead of overflowing past the visible area.
- Fixed the Files tab focus state.

  File and folder rows now show focus on the full list item instead of making the filename text appear focused.
- Fixed Markdown list roundtripping for bullets and checklists.

  FlashType now preserves single-item bullet lists, manually typed checklist markers, and content below mid-document edits when saving Markdown files.
- Fixed a crash when switching workspaces to an empty folder.

  FlashType now closes the previous workspace cleanly before opening the next one, so switching folders no longer leaves stale files or app state behind.

## 0.2.0 - 2026-06-17

### Minor

- Added diff review views for external Markdown and CSV file changes.

  FlashType now detects supported files changed outside the app and lets you accept or reject the update from an inline review.

### Patch

- Improved the macOS update flow.

  Checking for updates now opens a focused download progress window, and the header Update button appears only after an update is ready to install.

## 0.1.1 - 2026-06-15

### Patch

- Added a native Check for Updates menu item.

  The macOS app menu now uses the Flashtype name instead of the package name.

- Added an Update button to the app header.

  The button gives users a visible way to check for updates without opening the native app menu.

- Added the initial FlashType beta release.

  This release includes the macOS desktop app packaging flow, signed and notarized builds, and the first public beta experience for editing Markdown with FlashType.
