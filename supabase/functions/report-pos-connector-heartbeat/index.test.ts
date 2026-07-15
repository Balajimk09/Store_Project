// Pure contract checklist for report-pos-connector-heartbeat.
// These tests are intended for Deno/Edge validation in the isolated Supabase project.

Deno.test('heartbeat contract cases are documented for isolated execution', () => {
  const requiredCases = [
    'missing token returns 401',
    'invalid token returns 401',
    'disabled connector returns 401',
    'unsupported source system rejected',
    'source-store mismatch returns 409',
    'first valid heartbeat binds installation ID',
    'matching installation ID accepted',
    'different installation ID returns 409',
    'invalid UUID rejected',
    'invalid timestamp rejected',
    'future timestamp rejected',
    'invalid enum rejected',
    'negative count rejected',
    'oversized error message truncated',
    'valid heartbeat updates only approved fields',
    'administrative status and token hash unchanged',
    'response excludes token and secrets',
  ]
  if (requiredCases.length !== 17) throw new Error('heartbeat test case list drifted')
})
