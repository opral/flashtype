## Contributing

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v22 or higher)
- [pnpm](https://pnpm.io/) (v10 or higher)

> [!INFO]
> If you are developing on Windows, you need to use [WSL](https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux).

### Development

1. Clone the repository
2. Initialize the Lix and Atelier submodules: `git submodule update --init --recursive`
3. Install dependencies from the repo root: `pnpm install`
4. Build the vendored dependencies: `pnpm run build:lix && pnpm run build:atelier`
5. Start the app: `pnpm run dev` (the `predev` hook also builds both dependencies)

### Example

> [!INFO]
> Lix and Atelier are vendored submodules and pnpm workspace packages. Lix uses
> Nx caching; Atelier builds its package output before FlashType starts or builds.

> [!INFO]
> `@glideapps/glide-data-grid` is used for the CSV viewer. Its published peer
> range has not caught up to React 19, so `pnpm-workspace.yaml` intentionally
> allows the React 19 peer for Glide.

1. `git submodule update --init --recursive`
2. `pnpm install`
3. `pnpm run build:lix`
4. `pnpm run build:atelier`
5. `pnpm run dev`

### Opening a PR

1. `pnpm run ci`

### Next Release

For a user-facing release, edit `NEXT_RELEASE.md` at the repository root. Use `type: major`, `type: minor`, or `type: patch` frontmatter, followed by the exact changelog entry body. Leave the body empty when no release is pending.

Example:

```md
---
type: minor
---

- Warn before opening folders larger than 500 MB.
- Fix Markdown list editing with Tab, Shift+Tab, Backspace, and nested bullets.
```

Do not add `NEXT_RELEASE.md` for repo-only, documentation-only, CI-only, test-only, or chore-only changes.

The generated release PR resets `NEXT_RELEASE.md` back to an empty `type: patch` template.
