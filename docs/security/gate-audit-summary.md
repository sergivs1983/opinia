# Gate Audit Summary (Wave2 Closing)

Data: 2026-03-03
Commit verificat: `247ac06` (`wave2-lot3: internal guard batch 1`)

## Coverage Check

Comanda:

```bash
npx tsx scripts/security/gate_coverage_check.ts
```

Resultat:

```text
COVERAGE_CHECK=OK
docs=/Users/sergivallessantos/Desktop/opinia/docs/security/gate-audit.md
classified_total=116
pending_or_unknown=0
class_counts={"INTERNAL":17,"USER_FACING_TENANT":94,"INTERNAL_AUTH":1,"PUBLIC_NON_TENANT":4}
full_table_rows=126
gate_no_total=14
gate_no_non_public=10
warnings:
- Found 10 route(s) with gate=NO outside PUBLIC_NON_TENANT in docs table.
```

## CI Local (contract suites)

- `gate-priority-wave1-contract.test.ts`: **21/21 passed**
- `gate-wave2-writes-family.test.ts`: **62/62 passed**
- `gate-wave2-reads-family.test.ts`: **101/101 passed**
- `google-integrations-contract.test.ts`: **26/26 passed**
- `internal-guard-contract.test.ts`: **39/39 passed**

## Notes

- No hi ha rutes amb `STATUS=PENDING` o `STATUS=UNKNOWN` a la taula classificada.
- Hi ha una discrepància documental pendent a la taula completa (`Gate abans 1a query = NO` en 10 rutes no públiques); no s'ha tocat cap `route.ts` en aquest closing commit.
