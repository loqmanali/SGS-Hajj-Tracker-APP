# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/mobile exec eas update --branch production --message "..."` — ship an OTA JS-only update to installed SGS BagScan devices (see `artifacts/mobile/README.md`)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## SGS BagScan — Known Consequences of Team-Wins Merge (Task #29)

The team's GitHub branch (`subrepl-1iimcvco/main`) is the authoritative baseline. We merged it with `-X theirs`, so any conflict resolved to the team's hunk. Two consequences to monitor:

1. **Refresh cookie not sent.** The default `request()` helper in `artifacts/mobile/lib/api/sgs.ts` no longer sets `credentials: "include"`, and `/api/auth/refresh` no longer sets it explicitly. If the backend is still cookie-based for refresh, agents will be auto-logged-out at access-token expiry (the auth-failure handler signs them out and routes to `/login`). One-line fix if reports come in: re-add `credentials: "include"` to the `refresh()` call only — leave `login()` alone (it still sends it explicitly so the cookie is set).
2. **Single API URL across every EAS profile.** All EAS profiles (`development`, `preview`, `production`) point to `https://api-bagtracker-prod.saudiags.com` via `eas.json` build env + `app.json extra.eas.env`. Internal/dev builds therefore hit the prod database. If a staging environment appears, pin a per-profile `EXPO_PUBLIC_SGS_API_URL` in `eas.json` for `development`/`preview`.
