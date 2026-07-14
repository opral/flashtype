## Contributing

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v22 or higher)
- [pnpm](https://pnpm.io/) (v10 or higher)

> [!INFO]
> If you are developing on Windows, you need to use [WSL](https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux).

### Development

1. Clone the repository
2. Initialize the Atelier submodule: `git submodule update --init --recursive`
3. Install dependencies from the repo root: `pnpm install`
4. Build Atelier: `pnpm run build:atelier`
5. Start the app: `pnpm run dev` (the `predev` hook also builds Atelier and Electron's native dependency)

### Example

> [!INFO]
> Atelier is a vendored submodule and pnpm workspace package. Lix is consumed
> from the published `@lix-js/sdk` package. Atelier builds its package output
> before FlashType starts or builds.

> [!INFO]
> `@glideapps/glide-data-grid` is used for the CSV viewer. Its published peer
> range has not caught up to React 19, so `pnpm-workspace.yaml` intentionally
> allows the React 19 peer for Glide.

1. `git submodule update --init --recursive`
2. `pnpm install`
3. `pnpm run build:atelier`
4. `pnpm run dev`

### Opening a PR

1. `pnpm run ci`

### Next Release

For a user-facing release, edit `NEXT_RELEASE.md` at the repository root. Use `type: major`, `type: minor`, or `type: patch` frontmatter, followed by the exact changelog entry body. Leave the body empty when no release is pending.

Example:

```md
---
type: minor
version: 0.9.0
---

- Warn before opening folders larger than 500 MB.
- Fix Markdown list editing with Tab, Shift+Tab, Backspace, and nested bullets.
```

The optional `version` field targets a specific later version while preserving
the declared change type. Omit it for the normal one-step semantic version bump.

Do not add `NEXT_RELEASE.md` for repo-only, documentation-only, CI-only, test-only, or chore-only changes.

The generated release PR resets `NEXT_RELEASE.md` back to an empty `type: patch` template.
