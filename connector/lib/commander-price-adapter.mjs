import { CommanderPriceAdapterError } from './pos-publish-errors.mjs'

export function assertCommanderPriceAdapter(adapter) {
  if (!adapter || typeof adapter.updatePrice !== 'function' || typeof adapter.readProduct !== 'function') {
    throw new CommanderPriceAdapterError('malformed_response', 'Commander adapter is unavailable.')
  }
  const invoke = async (method, input) => {
    try {
      return await adapter[method](input)
    } catch (error) {
      if (error instanceof CommanderPriceAdapterError) throw error
      throw new CommanderPriceAdapterError('malformed_response', 'Commander adapter returned an unexpected error.')
    }
  }
  return {
    updatePrice: (input) => invoke('updatePrice', input),
    readProduct: (input) => invoke('readProduct', input),
  }
}

// This mock-only adapter deliberately contains no network, authentication, XML, or Commander protocol code.
export function createMockCommanderPriceAdapter({ updatePrice, readProduct }) {
  return assertCommanderPriceAdapter({ updatePrice, readProduct })
}

export { CommanderPriceAdapterError }
