export const NAMESPACE = 'urn:vfi-sapphire:np.domain.2001-07-01'

export function document(body, attributes = '') {
  return `<domain:PLUs xmlns:domain="${NAMESPACE}"${attributes}>${body}</domain:PLUs>`
}

export function nested(depth, body) {
  let result = body
  for (let index = 0; index < depth; index += 1) result = `<node>${result}</node>`
  return result
}

export function records(count) {
  return '<PLU/>'.repeat(count)
}
