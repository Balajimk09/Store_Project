import { TextDecoder } from 'node:util';

const MAX_BYTES = 8192;
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };

/** Executes the fixed cookie worker. Its cookie is returned only to the session manager. */
export async function authenticateCommanderCookie({ powershellPath, workerPath, spawnProcess, timeoutMilliseconds = 25_000 } = {}) {
  if (typeof powershellPath !== 'string' || typeof workerPath !== 'string' || typeof spawnProcess !== 'function') fail('authentication_failed');
  let child; let timer;
  try {
    child = spawnProcess(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', workerPath], { shell: false, windowsHide: true });
    const pending = child?.result ? Promise.resolve(child.result) : null;
    if (!pending) fail('authentication_failed');
    const outcome = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), timeoutMilliseconds); })]);
    clearTimeout(timer);
    if (outcome?.timeout) { child.kill?.(); fail('authentication_failed'); }
    const stdout = Buffer.from(outcome?.stdout ?? []); const stderr = Buffer.from(outcome?.stderr ?? []);
    if (outcome?.exitCode !== 0 || stdout.length < 1 || stdout.length > MAX_BYTES || stderr.length !== 0) fail('authentication_failed');
    let record;
    try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout)); } catch { fail('authentication_failed'); }
    if (!record || Object.keys(record).length !== 1 || typeof record.cookie !== 'string' || record.cookie.length < 1 || record.cookie.length > 4096 || /[\u0000-\u001f\u007f-\u009f&=]/u.test(record.cookie)) fail('authentication_failed');
    return { cookie: record.cookie };
  } catch (error) {
    if (timer) clearTimeout(timer);
    fail(error?.code === 'authentication_failed' ? 'authentication_failed' : 'authentication_failed');
  }
}
