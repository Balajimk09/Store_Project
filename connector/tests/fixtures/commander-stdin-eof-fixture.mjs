const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
if (value?.fixture !== true) process.exitCode = 1
else process.stdout.write('{"ok":true}')
