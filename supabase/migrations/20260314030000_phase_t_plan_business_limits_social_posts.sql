begin;

do $$
begin
  if to_regclass('public.organizations') is null then
    raise notice 'Table public.organizations not found - skipping plan business limits migration';
    return;
  end if;

  alter table public.organizations
    add column if not exists seats_limit integer,
    add column if not exists business_limit integer,
    add column if not exists plan_price_cents integer,
    add column if not exists billing_status text;

  update public.organizations
  set
    seats_limit = coalesce(
      seats_limit,
      case
        when lower(coalesce(nullif(plan_code, ''), nullif(plan, ''), 'starter_49')) in ('pro_149', 'scale', 'scale_149') then 6
        else 2
      end
    ),
    business_limit = coalesce(
      business_limit,
      case
        when lower(coalesce(nullif(plan_code, ''), nullif(plan, ''), 'starter_49')) in ('pro_149', 'scale', 'scale_149') then 10
        else 3
      end
    ),
    plan_price_cents = coalesce(
      plan_price_cents,
      case
        when lower(coalesce(nullif(plan_code, ''), nullif(plan, ''), 'starter_49')) in ('pro_149', 'scale', 'scale_149') then 14900
        else 4900
      end
    ),
    billing_status = coalesce(nullif(billing_status, ''), 'active');

  alter table public.organizations
    alter column billing_status set default 'active';
end
$$;

notify pgrst, 'reload schema';

commit;
