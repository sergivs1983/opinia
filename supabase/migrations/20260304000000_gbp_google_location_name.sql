-- ANNEX Flow B: GBP multi-local import metadata on businesses
-- Safe/idempotent migration. Apply, then run:
-- NOTIFY pgrst, 'reload schema';

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS google_location_name text,
  ADD COLUMN IF NOT EXISTS google_account_id text,
  ADD COLUMN IF NOT EXISTS city text;

-- Backfill from previous field when possible.
UPDATE public.businesses
SET google_location_name = CASE
  WHEN google_location_name IS NOT NULL THEN google_location_name
  WHEN google_location_id IS NOT NULL THEN concat('locations/', google_location_id)
  ELSE NULL
END
WHERE google_location_name IS NULL
  AND google_location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_businesses_org_google_location_name_not_null
  ON public.businesses (org_id, google_location_name)
  WHERE google_location_name IS NOT NULL;

COMMENT ON COLUMN public.businesses.google_location_name IS
  'Google Business location resource name (e.g. locations/123456789).';
COMMENT ON COLUMN public.businesses.google_account_id IS
  'Google account resource id associated with the location.';
