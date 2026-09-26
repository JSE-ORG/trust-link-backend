# Security audit workflow — required patch for #779

The licence compliance gate in `.github/workflows/security-audit.yml` is skipped
whenever the preceding `npm audit` step fails, because the step has no `if:`
condition. `npm audit` has failed every week since at least 2026-09-07, so the
licence gate has not run in that period.

The gate logic now lives in `scripts/check-licences.js` (runnable locally with
`npm run check-licences`) so the workflow only has to decide *when* to run it.
Apply the patch below to `.github/workflows/security-audit.yml`.

## 1. Run the licence gate regardless of the audit result

```diff
       - name: Check licence compliance
         id: licences
+        # `if: always()` so a failing `npm audit` above cannot skip the licence
+        # gate (#779). The step still fails the job on a banned licence: there
+        # is no `continue-on-error` here, and `always()` only controls whether
+        # the step runs, not the job conclusion.
+        if: always()
         run: |
-          npx license-checker --production \
-            --excludePackages "elkjs@0.11.1" \
-            --failOn "GPL-2.0;GPL-3.0;AGPL-3.0;SSPL-1.0;EUPL-1.1;OSL-3.0;CPAL-1.0;CPL-1.0;EPL-1.0;EPL-2.0;CDDL-1.0;CDDL-1.1;MPL-2.0" \
-            --summary
+          npm run check-licences
```

`if: always()` only affects whether the step runs. It does **not** mask a
failure: the step has no `continue-on-error`, so a banned licence still fails
the job. Do not add `continue-on-error` to this step — combined with
`always()` it would turn a real licence failure green.

## 2. Name the failing gate in the issue body

Both gates currently produce the same issue body, so triage cannot tell which
one failed. Pass each step's outcome into the issue step and branch on it:

```diff
       - name: Raise or update issue on failure
         if: failure()
         env:
           GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
           RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
+          AUDIT_OUTCOME: ${{ steps.audit.outcome }}
+          LICENCE_OUTCOME: ${{ steps.licences.outcome }}
         run: |
           TITLE="Scheduled security audit failed"
-          BODY="The weekly dependency audit or licence compliance check failed.
-
-          Run: $RUN_URL
-
-          Download the \`security-audit-reports\` artifact from that run for the
-          full \`npm audit\` and licence output.
-
-          This does not block merges by design. Triage and either upgrade the
-          affected dependency or record why the advisory does not apply."
+
+          FAILED=""
+          if [ "$AUDIT_OUTCOME" = "failure" ]; then
+            FAILED="${FAILED}- **Dependency audit** (\`npm audit --audit-level=moderate\`) failed: a known advisory affects a dependency at moderate severity or above. Triage by upgrading or patching the affected package, or record why the advisory does not apply.
+          "
+          fi
+          if [ "$LICENCE_OUTCOME" = "failure" ]; then
+            FAILED="${FAILED}- **Licence compliance** (\`license-checker --production\`) failed: a production dependency uses a banned licence. Triage by replacing the dependency, or by adding a justified exclusion to the \`--excludePackages\`/\`--failOn\` list in \`scripts/check-licences.js\`.
+          "
+          fi
+          if [ -z "$FAILED" ]; then
+            FAILED="- The job failed before either gate reported a result; check the run log for the failing step.
+          "
+          fi
+
+          BODY="The weekly security audit failed.
+
+          Run: $RUN_URL
+
+          Failing gate(s):
+
+          $FAILED
+          Download the \`security-audit-reports\` artifact from that run for the
+          full \`npm audit\` and licence output.
+
+          This does not block merges by design. Triage the gate(s) listed above."
```

`steps.<id>.outcome` is used rather than `conclusion` so a skipped step is not
reported as a pass.

## Verification

Trigger the workflow with `workflow_dispatch` and confirm both the
`Run npm audit` and `Check licence compliance` steps execute, even when the
audit step fails.
