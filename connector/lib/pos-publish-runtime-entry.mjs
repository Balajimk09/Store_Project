import { createPosPublishRuntime, toSafePosPublishChildResult } from './pos-publish-runtime.mjs'

const MAX_INPUT_BYTES = 8 * 1024
const INPUT_KEYS = new Set(['connector_token', 'trusted_source_endpoint_url', 'poll_seconds', 'worker_version'])

async function readBoundedInput() {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    total += chunk.length
    if (total > MAX_INPUT_BYTES) throw new Error('invalid_input')
    chunks.push(chunk)
  }
  if (total === 0) throw new Error('invalid_input')
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid_input') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('invalid_input')
  if (Object.keys(value).length !== INPUT_KEYS.size || Object.keys(value).some((key) => !INPUT_KEYS.has(key))) throw new Error('invalid_input')
  return value
}

try {
  const input = await readBoundedInput()
  // No Commander adapter is supplied on this branch. The runtime fails closed before claim/API work.
  const runtime = createPosPublishRuntime({
    enabled: true,
    pollSeconds: input.poll_seconds,
    trustedSourceEndpointUrl: input.trusted_source_endpoint_url,
    connectorToken: input.connector_token,
    workerVersion: input.worker_version,
    commanderAdapter: null,
  })
  process.stdout.write(JSON.stringify(toSafePosPublishChildResult(await runtime.processOne())))
} catch {
  process.stdout.write(JSON.stringify(toSafePosPublishChildResult({
    outcome: 'configuration_error',
    state: 'configuration_error',
    last_error_code: 'pos_publish_configuration_invalid',
  })))
}
