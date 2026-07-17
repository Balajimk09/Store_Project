const chunks = []

process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  let ok = false
  let hasBom = false
  let leaked = true
  let tokenPresent = false
  let tokenMatches = false
  let labelMatches = false
  let parseOk = false
  try {
    const bytes = Buffer.concat(chunks)
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
    parseOk = true
    const token = value?.connector_token
    tokenPresent = typeof token === 'string'
    tokenMatches = token === 'token-stdin-only-sentinel'
    labelMatches = value.label === 'caf\u00e9'
    hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    leaked = !tokenPresent || process.argv.join('|').includes(token) || Object.keys(process.env).some((key) => String(process.env[key]).includes(token))
    ok = !hasBom && !leaked && tokenMatches && labelMatches
  } catch {}
  process.stdout.write(JSON.stringify({
    outcome: ok ? 'completed' : 'internal_error',
    state: ok ? 'completed' : 'error',
    last_job_id: null,
    last_error_code: ok ? null : !parseOk ? 'job_expired' : hasBom ? 'commander_adapter_unavailable' : !tokenPresent ? 'plu_not_found' : leaked ? 'pos_publish_configuration_invalid' : !tokenMatches ? 'verification_failed' : !labelMatches ? 'update_rejected' : 'internal_connector_error',
  }))
})
