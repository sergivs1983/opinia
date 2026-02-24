# RLS Blueprint (Spotify Familiar)

Objectiu: fer explícit el model multi-tenant per organització (`org_id`) sense tocar producció de manera arriscada en aquest sprint.

## Principis

- Workspace compartit: un usuari veu dades d'una org si té membership acceptada a aquella org.
- Dades privades d'usuari: només propietari (`owner_user_id = auth.uid()`).
- Cap política amb accés global per defecte.

## Helpers SQL recomanats

```sql
-- Org IDs accessibles per l'usuari actual
create or replace function public.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.accepted_at is not null;
$$;
```

## Policies recomanades

### organizations

```sql
alter table public.organizations enable row level security;

create policy if not exists organizations_select_member
on public.organizations
for select
using (id in (select public.user_org_ids()));
```

### memberships

```sql
alter table public.memberships enable row level security;

create policy if not exists memberships_select_self_or_org_owner
on public.memberships
for select
using (
  user_id = auth.uid()
  or org_id in (select public.user_org_ids())
);
```

### businesses (shared per org)

```sql
alter table public.businesses enable row level security;

create policy if not exists businesses_select_member
on public.businesses
for select
using (org_id in (select public.user_org_ids()));
```

### reviews / replies (si són shared per org)

```sql
alter table public.reviews enable row level security;
alter table public.replies enable row level security;

create policy if not exists reviews_select_member
on public.reviews
for select
using (org_id in (select public.user_org_ids()));

create policy if not exists replies_select_member
on public.replies
for select
using (org_id in (select public.user_org_ids()));
```

### Logs/activitats privades per usuari (si aplica `owner_user_id`)

```sql
alter table public.activities enable row level security;

create policy if not exists activities_select_owner
on public.activities
for select
using (owner_user_id = auth.uid());
```

## Rollout segur (recomanat)

1. Auditar consultes actuals per taula (`select`, `insert`, `update`, `delete`).
2. Afegir policies en entorn staging.
3. Executar smoke tests de dashboard per org compartida + usuari sense accessos.
4. Activar producció per lots (primer `select`, després `write`).

## Checklist abans d'aplicar a prod

- [ ] Cada taula té `org_id` o `owner_user_id` clar.
- [ ] No hi ha rutes server que depenguin d'accés global.
- [ ] Totes les consultes API passen `org_id` de context segur (membership), no del client.
- [ ] E2E multi-org validat (canvi org + refresc + permisos).
