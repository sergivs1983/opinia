-- FASE 2: backfill a codis canònics i estrènyer constraint
BEGIN;

-- starter
UPDATE public.organizations
SET plan_code = 'starter'
WHERE plan_code IN ('starter_29', 'starter_49', 'free');

-- business
UPDATE public.organizations
SET plan_code = 'business'
WHERE plan_code IN ('pro', 'pro_49');

-- scale
UPDATE public.organizations
SET plan_code = 'scale'
WHERE plan_code IN ('pro_149', 'scale_149', 'enterprise');

-- Verificació (no deixar legacy)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE plan_code NOT IN ('starter', 'business', 'scale')
  ) THEN
    RAISE EXCEPTION 'Backfill incomplet: resten plan_code no canònics';
  END IF;
END
$$;

COMMIT;

-- Estrènyer constraint als canònics
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_plan_code_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_code_check CHECK (
    plan_code IN ('starter', 'business', 'scale')
  );

-- Ara sí: DEFAULT canònic
ALTER TABLE public.organizations
  ALTER COLUMN plan_code SET DEFAULT 'starter';
