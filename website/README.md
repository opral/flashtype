# Flashtype website

Landing page for [Flashtype](https://flashtype.ai), built with
[TanStack Start](https://tanstack.com/start) and Tailwind CSS v4.

This package is intentionally standalone (it has its own
`pnpm-workspace.yaml`) so it installs and deploys without the app's
submodules being checked out.

```sh
cd website
pnpm install
pnpm dev      # http://localhost:3060
pnpm build    # output in dist/ (client + SSR worker)
pnpm deploy   # build + wrangler deploy (Cloudflare Workers)
```

Deployment runs on Cloudflare Workers via `@cloudflare/vite-plugin` and
`wrangler.json`. Run `npx wrangler login` once before the first deploy.
