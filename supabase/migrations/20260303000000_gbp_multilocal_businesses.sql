-- Flow B multi-local (Google Business Profile)
-- Adds Google location linkage columns to businesses.
-- Idempotent and safe to re-run.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS google_location_id text,
  ADD COLUMN IF NOT EXISTS google_account_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_businesses_google_location_id_not_null
  ON public.businesses (google_location_id)
  WHERE google_location_id IS NOT NULL;

COMMENT ON COLUMN public.businesses.google_location_id IS
  'Google Business Profile location identifier linked to this local business.';
COMMENT ON COLUMN public.businesses.google_account_id IS
  'Google account resource associated with the imported location.';
