import { pathToFileURL } from 'node:url'

import {
  createSelectedProductSnapshotExportDependencies,
} from '../lib/commander/maintenance/create-selected-product-snapshot-export-dependencies.mjs'

function failure(code) {
  return {
    ok: false,
    read_only: true,
    snapshot_written: false,
    selection_count: 0,
    received_product_count: 0,
    safe_error_code: code,
  }
}

export function parseSelectedProductSnapshotExportCli(args) {
  const exact = (
    Array.isArray(args)
    && args.length === 7
    && args[0] === '--operation'
    && args[1] === 'export_selected_products_snapshot'
    && args[2] === '--approve'
    && args[3] === 'export_selected_products_snapshot'
    && args[4] === '--supervised'
    && args[5] === '--read-only'
    && args[6] === '--selected-products-reviewed'
  )

  return {
    approval: {
      approved: exact,
      operation: exact ? 'export_selected_products_snapshot' : '',
      supervised: exact,
      read_only: exact,
      selected_products_reviewed: exact,
    },
    cli_invalid: !exact,
  }
}

export function selectedProductSnapshotExportExitCode(result) {
  return result?.ok === true ? 0 : 1
}

export async function runSelectedProductSnapshotExportCli({
  args = process.argv.slice(2),
  dependencyFactory = createSelectedProductSnapshotExportDependencies,
  stdout = process.stdout,
} = {}) {
  const input = parseSelectedProductSnapshotExportCli(args)
  let result

  if (input.cli_invalid) {
    result = failure('invalid_input')
  } else {
    try {
      const dependencies = dependencyFactory({ moduleUrl: import.meta.url })
      if (
        !dependencies
        || typeof dependencies.executeSelectedProductSnapshotExport
          !== 'function'
      ) {
        result = failure('internal_failure')
      } else {
        result = await dependencies.executeSelectedProductSnapshotExport(input)
      }
    } catch {
      result = failure('internal_failure')
    }
  }

  stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSelectedProductSnapshotExportCli()
    .then((result) => {
      process.exitCode = selectedProductSnapshotExportExitCode(result)
    })
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify(failure('internal_failure'))}\n`,
      )
      process.exitCode = 1
    })
}
