# E2E (Playwright)

Aquest repo inclou 3 fluxos crítics E2E a `tests/e2e`:

1. `onboarding.spec.ts`
2. `inbox-generate.spec.ts`
3. `settings.spec.ts`

## Prerequisits

- Node 18.17+
- Variables d'entorn disponibles (`.env.local`):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

`global-setup` crea automàticament usuaris i dades mínimes (org + business + review) per executar els tests de manera deterministic.

## Instal·lació

```bash
npm install
npx playwright install chromium
```

## Execució

```bash
npm run test:e2e
```

Opcional:

```bash
npm run test:e2e:ui
npm run test:e2e:headed
```

## Notes

- Port per E2E: `3100` (`npm run dev:e2e`).
- Estat seed temporal: `.e2e/state.json`.
- Report HTML: `playwright-report/`.
