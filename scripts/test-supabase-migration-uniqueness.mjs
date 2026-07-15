import { readdir } from 'node:fs/promises'
import path from 'node:path'

const migrationsDir = path.resolve('supabase/migrations')
const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right))

const versionPattern = /^(\d{14})_.+\.sql$/
const invalidNames = files.filter((file) => !versionPattern.test(file))
const versions = new Map()

for (const file of files) {
  const version = file.match(versionPattern)?.[1]
  if (!version) continue
  const entries = versions.get(version) ?? []
  entries.push(file)
  versions.set(version, entries)
}

const duplicateVersions = [...versions.entries()].filter(([, entries]) => entries.length > 1)

if (invalidNames.length || duplicateVersions.length) {
  if (invalidNames.length) {
    console.error('Migration filenames must start with a unique 14-digit version:')
    for (const file of invalidNames) console.error(`  ${file}`)
  }

  if (duplicateVersions.length) {
    console.error('Duplicate migration versions found:')
    for (const [version, entries] of duplicateVersions) {
      console.error(`  ${version}: ${entries.join(', ')}`)
    }
  }

  process.exit(1)
}

console.log(`Validated ${files.length} Supabase migrations with unique 14-digit versions.`)
