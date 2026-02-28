# Smoke scripts

- `./scripts/smoke-flow-c-rules.sh http://localhost:3000` prepara una rule + rule_run de prova, crida el worker intern amb HMAC i valida que el `rule_run` acaba en `done`.
- Requereix `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` i `INTERNAL_HMAC_SECRET` en l'entorn del shell.
