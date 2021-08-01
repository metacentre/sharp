import { BlobId } from 'ssb-typescript'
import { CheckImageStoreProps, CheckImageStoreValue, StoreImageBlobProps } from './types'
import Debug from 'debug'

const debug = Debug('plugins:sharp')

type Ssb = any

export function haveBlob(rpc: Ssb, blobId: BlobId) {
  return new Promise((resolve, reject) => {
    rpc.blobs.has(blobId, (error: string, haveBlob: boolean) => {
      if (error) {
        const errorMsg = `[@metacentre/sharp] Error querying rpc.blobs.has for ${blobId}`
        reject(errorMsg)
      }
      if (haveBlob) {
        debug(`[@metacentre/sharp] found blob to process ${blobId} ${haveBlob}`)
        resolve(true)
      }
      reject(`[@metacentre/sharp] blob not found ${blobId}`)
    })
  }).catch(error => debug(`[@metacentre/sharp] Caught haveBlob() error ${error}`))
}

export function findKeyInObject(obj = {}, key: string): any[] {
  const result: any[] = []
  function search(obj = {}) {
    if (!obj || typeof obj !== 'object') {
      return
    }
    if (obj[key]) {
      result.push(obj[key])
    }
    Object.keys(obj).forEach(k => {
      search(obj[k])
    })
  }
  search(obj)
  return result
}

export function checkImageStore({ store, blobId, format, size }: CheckImageStoreProps): Promise<CheckImageStoreValue> {
  return new Promise(async resolve => {
    const imageMetadata = await store.get(blobId)

    if (Array.isArray(imageMetadata)) {
      imageMetadata.forEach(metadata => {
        const [storedFormat, storedSize, storedFilename] = metadata
        if (storedSize === size && storedFormat === format) resolve({ found: true, metadata })
      })
      resolve({ found: false, metadata: imageMetadata })
    }
    resolve({ found: false, metadata: [] })
  })
}

export async function storeImageBlob(props: StoreImageBlobProps) {
  const { store, id, format, size, filename } = props
  const imageMetadata = await store.get(id)

  if (Array.isArray(imageMetadata)) {
    imageMetadata.push([format, size, filename])
    store.set(id, imageMetadata)
  } else store.set(id, [[format, size, filename]])
}
