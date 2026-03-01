-- FASE 1 (non-breaking): ampliar constraint perquè accepti legacy + canònics
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_plan_code_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_code_check CHECK (
    plan_code IN (
      -- legacy actuals i esperables
      'starter_29', 'starter_49', 'free',
      'pro', 'pro_49', 'pro_149',
      'scale_149', 'enterprise',
      -- canònics
      'starter', 'business', 'scale'
    )
  );

-- Opcional (recomanat): NO canviïs DEFAULT encara si vols risc mínim.
-- Si vols canviar-lo ara:
-- ALTER TABLE public.organizations ALTER COLUMN plan_code SET DEFAULT 'starter';
