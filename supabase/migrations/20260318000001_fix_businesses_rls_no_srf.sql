-- ============================================================
-- Fix: replace user_biz_ids() SRF in businesses RLS policies (P1)
--
-- PROBLEM: 20260225000000_rls_multi_tenant.sql creates policies on
--   public.businesses using:
--     id in (select public.user_biz_ids())
--   This is a Set-Returning Function (SRF) call inside a USING / WITH CHECK
--   expression, which violates the "no SRF in RLS policies" constraint.
--
-- FIX: Replace the SRF-based expressions with equivalent EXISTS subqueries
--   that join business_memberships directly. Same security guarantees,
--   no SRF in policy expressions.
--
-- SAFE / IDEMPOTENT:
--   DROP POLICY IF EXISTS before every CREATE POLICY.
--   Does NOT drop user_biz_ids() — other tables may still reference it.
-- ============================================================

-- ── SELECT ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "businesses_biz_select" ON public.businesses;

CREATE POLICY "businesses_biz_select"
  ON public.businesses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.business_memberships bm
      WHERE  bm.business_id = businesses.id
        AND  bm.user_id     = auth.uid()
        AND  bm.is_active   = true
    )
  );

-- ── UPDATE ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "businesses_biz_update" ON public.businesses;

CREATE POLICY "businesses_biz_update"
  ON public.businesses
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM   public.business_memberships bm
      WHERE  bm.business_id = businesses.id
        AND  bm.user_id     = auth.uid()
        AND  bm.is_active   = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM   public.business_memberships bm
      WHERE  bm.business_id = businesses.id
        AND  bm.user_id     = auth.uid()
        AND  bm.is_active   = true
    )
  );

-- ── INSERT / DELETE (blocked — unchanged, no SRF involved) ─────────────────
-- Recreated idempotently to ensure a clean state after any previous
-- schema drift.
DROP POLICY IF EXISTS "businesses_biz_insert" ON public.businesses;
CREATE POLICY "businesses_biz_insert"
  ON public.businesses
  FOR INSERT
  WITH CHECK (false);   -- only service_role may insert

DROP POLICY IF EXISTS "businesses_biz_delete" ON public.businesses;
CREATE POLICY "businesses_biz_delete"
  ON public.businesses
  FOR DELETE
  USING (false);        -- only service_role may delete

-- ── Verification hint (runs at migration time) ──────────────────────────────
DO $$
DECLARE
  v_srf_count integer;
BEGIN
  SELECT count(*) INTO v_srf_count
  FROM   pg_policies
  WHERE  schemaname = 'public'
    AND  tablename  = 'businesses'
    AND  (qual       LIKE '%user_biz_ids%'
       OR with_check LIKE '%user_biz_ids%');

  IF v_srf_count > 0 THEN
    RAISE EXCEPTION
      'Migration check failed: % businesses policies still reference user_biz_ids()',
      v_srf_count;
  END IF;

  RAISE NOTICE 'businesses RLS policies: SRF check passed (0 remaining references)';
END
$$;
