import { BlobId } from 'ssb-typescript'
import Debug from 'debug'

const debug = Debug('plugins:sharp')

export function haveBlob(rpc: any, blobId: BlobId) {
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
  }).catch(error =>
    debug(`[@metacentre/sharp] Caught haveBlob() error ${error}`)
  )
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
