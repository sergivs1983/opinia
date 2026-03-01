# Smoke scripts

- `./scripts/smoke-flow-c-rules.sh http://localhost:3000` prepara una rule + rule_run de prova, crida el worker intern amb HMAC i valida que el `rule_run` acaba en `done`.
- Requereix `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` i `INTERNAL_HMAC_SECRET` en l'entorn del shell.
- `./scripts/smoke-flow-d1-10-voice.sh http://localhost:3000` valida guards de LITO Voice (`prepare`/`transcribe`) i, opcionalment amb sessió real, comprova creació de drafts d'acció (`/api/lito/action-drafts`).
- `./scripts/smoke-flow-d2-1-signals-pro.sh http://localhost:3000` valida guards de `GET /api/lito/signals-pro` i del worker intern `POST /api/_internal/signals/run` (HMAC), amb test funcional opcional si hi ha cookie + `FLOW_D21_BIZ_ID`.
- `node --env-file=.env.local --import tsx/esm scripts/run-signals-backfill.ts http://localhost:3000` recorre negocis amb integració `google_business` activa i executa el worker intern de signals amb HMAC (backfill manual/scheduler MVP).
- `./scripts/smoke-flow-d2-3-reminders.sh http://localhost:3000` valida guards de scheduling social (`/api/social/schedules`), del runner intern (`/api/_internal/social/reminders/run`) i, opcionalment amb sessió + HMAC, el flux complet de recordatoris in-app.
