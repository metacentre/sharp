import { haveBlob, findKeyInObject, checkImageStore, storeImageBlob } from './utils'
import { MakeSrcSetOptions, SharpResizeOptions, CheckImageStoreValue } from './types'
import pull, { Source } from 'pull-stream'
import paramap from 'pull-paramap'
import { isBlobId } from 'ssb-ref'
import { BlobId } from 'ssb-typescript'
import { isMsg } from 'ssb-typescript/utils'
import sharp from 'sharp'
import { join } from 'path'
import { writeFile } from 'fs'
import base32 from 'base32'
import mkdirp from 'mkdirp'
import Debug from 'debug'
import { KeyvFile } from 'keyv-file'
import Keyv from 'keyv'

const debug = Debug('plugins:sharp')
const pkg = require('../package.json')

type Ssb = any

const plugin = {
  name: 'sharp',
  version: pkg.version,
  manifest: {
    resize: 'async',
    makeSrcSet: 'source',
    process: 'sync',
    getBlobMetadata: 'async'
  },
  init(rpc: Ssb, config: any) {
    debug(`[${pkg.name} v${pkg.version}] init`)

    const sharpDir = join(config.path, 'sharp')
    const imageDir = join(sharpDir, 'images')
    mkdirp.sync(imageDir)

    const format = config.sharp?.format
    const sizes = config.sharp?.sizes
    if (!format || !sizes)
      throw new Error(`
        [${pkg.name} v${pkg.version}] 
        Did you forget to set sharp config in ~/.ssb/config ?
        
        You can set something like this. Format is webp | png | avif
        {
          "sharp": {
            "format": "webp",
            "sizes": [300, 600, 1024]
          }
        }
        
        `)

    const store: Keyv<any> = new Keyv({
      namespace: 'sharp',
      store: new KeyvFile({
        filename: join(sharpDir, 'store.json'),
        expiredCheckDelay: 24 * 3600 * 1000, // ms, check and remove expired data in each ms
        writeDelay: 100, // ms, batch write to disk in a specific duration, enhance write performance.
        encode: JSON.stringify, // serialize function
        decode: JSON.parse // deserialize function
      })
    })
    store.on('error', (error: any) =>
      console.error('[@metacentre/sharp] Error connecting to persistent keyv store', error)
    )

    let imageQueue: string[] = []
    const imageSet: any = {}

    function enqueue(s: BlobId | string) {
      if (isBlobId(s)) {
        if (!imageSet[s]) {
          imageSet[s] = true
          imageQueue.push(s)
        }
      }
    }

    /** process message looking for images in data */
    function process(data: any) {
      const mdImageRegex = /!\[(.*?)\]\((.*?)\)/g

      /** adapted from ssb-ref. thanks! :) */
      const blobIdRegex = /([&][A-Za-z0-9/+]{43}=\.[\w\d]+)/g

      const haveData = (arr: any[]) => arr.length > 0

      /** if it's a log message look in known locations within common message types */
      if (isMsg(data)) {
        /**
         * post messages have markdown content under text key
         * for blogs it's under the blog key, and maybe in summary
         * */
        const text = findKeyInObject(data, 'text')
        const blog = findKeyInObject(data, 'blog')
        const summary = findKeyInObject(data, 'summary')
        const markdown = [...text, ...blog, ...summary]

        if (haveData(markdown)) {
          const matches = mdImageRegex.exec(JSON.stringify(markdown))
          if (matches) {
            matches.forEach(s => enqueue(s))
          }
        }

        /** mentions commonly have image links */
        const mentions = findKeyInObject(data, 'mentions')
        if (haveData(mentions)) {
          const matches = blobIdRegex.exec(JSON.stringify(mentions))
          if (matches) {
            matches.forEach(s => enqueue(s))
          }
        }

        /**
         * about messages commonly have profile images
         * and blogs may have a thumbnail
         * */
        const image = findKeyInObject(data, 'image')
        const imageUrl = findKeyInObject(data, 'imageUrl')
        const thumbnail = findKeyInObject(data, 'thumbnail')
        const images = [...image, ...imageUrl, ...thumbnail]
        if (haveData(images)) {
          const matches = blobIdRegex.exec(JSON.stringify(images))
          if (matches) {
            matches.forEach(s => enqueue(s))
          }
        }
      } else {
        /**
         * otherwise throw the blobId regex over the whole data object.
         * because we might be looking at data
         * returned from a graphql query
         * which isn't in log message format
         * */
        const matches = blobIdRegex.exec(JSON.stringify(data))
        if (matches) {
          matches.forEach(s => enqueue(s))
        }
      }

      /** process the queue */
      imageQueue.forEach(blobId => {
        const images = makeSrcSet({
          blobId,
          sizes,
          format
        })
        pull(
          images,
          pull.collect((error, images) => {})
        )
      })
      imageQueue = []
    }

    function makeSrcSet(options: MakeSrcSetOptions) {
      const { blobId, sizes, format } = options
      const source = pull(
        pull.values(sizes),
        paramap((size: number, cb: Function) => {
          resize({ blobId, size, format }, (error: any, data: string) => {
            if (error) {
              return cb(error)
            }
            cb(null, data)
          })
        })
      )
      return source
    }

    async function resize(options: SharpResizeOptions, cb: Function) {
      cb = cb ?? console.log
      const { blobId, size, format } = options

      debug('resize called with', options)
      if (!isBlobId(blobId)) {
        const error = `[@metacentre/sharp] Error at get(blobId) is not a valid blob id ${blobId}`
        return cb(error)
      }

      /**
       * check the store for if we've previously resized this blob
       * */

      const { metadata, found } = await checkImageStore({ store, blobId, format, size })
      if (found) {
        /** if found, then we've already processed this image at this format and size, so callback */
        const [format, size, filename] = metadata
        debug(`image already processed ${blobId} ${metadata}`)
        return cb(null, { id: blobId, format, filename, size })
      }
      debug(`image already not processed ${blobId} ${metadata}`)

      /**
       * not resized previously, so check if we have the blob in the multiblob store
       * */
      const blobFound = await haveBlob(rpc, blobId)
      if (!blobFound) {
        /**
         * ask for the missing blob and continue
         * it will end up processed at some later time
         * if we are able to retrieve it
         * */
        rpc.blobs.want(blobId)
        const msg = `Blob ${blobId} not found. Asking peers for it...`
        debug(msg)
        return cb(msg)
      }

      /** we have the blob so let's resize it */
      const bufferStream: Source<readonly Uint8Array[][]> = rpc.blobs.get(blobId)
      // const bufferStream: Source<Uint8Array[]> = rpc.blobs.get(blobId)
      if (!bufferStream) return cb(`[@metacentre/sharp] Error getting blob ${blobId}...`)

      /** encode the blobId to base32 so it's filename and url safe */
      const filename = `${base32.encode(blobId)}.${size}.${format}`

      // prettier-ignore
      const transform = (bufferArray: readonly Uint8Array[] ) => {
        if (format === 'webp')
          return sharp(
            Buffer.concat(bufferArray))
            .resize(Number(size), Number(size))
            .webp()
        if (format === 'avif')
          return sharp(
            Buffer.concat(bufferArray))
            .resize(Number(size), Number(size))
            .avif()
        if (format === 'png')
          return sharp(
            Buffer.concat(bufferArray))
            .resize(Number(size), Number(size))
            .png()
      }

      pull(
        bufferStream,
        pull.collect((error, bufferArray) => {
          if (error) {
            return cb(error)
          } else {
            try {
              transform(bufferArray)
                .toBuffer()
                .then(imgBuffer => {
                  if (imgBuffer) {
                    writeFile(join(imageDir, filename), imgBuffer, error => {
                      if (error) {
                        const errorMsg = `[@metacentre/sharp] Error writing transformed image to disk ${error}`
                        return cb(errorMsg)
                      }
                      storeImageBlob({ store, id: blobId, format, size, filename })
                      cb(null, { id: blobId, format, filename, size })
                      debug(`Successfully transformed ${blobId} to ${size}px and wrote to ${filename}`)
                    })
                  }
                })
                .catch((error: any) => debug(`[@metacentre/sharp] error transforming image buffer ${error}`))
            } catch (error) {
              const errorMsg = `[@metacentre/sharp] failed to transform blob. ${error}`
              debug(errorMsg)
              console.error(errorMsg)
              return cb(errorMsg)
            }
          }
        })
      )
    }

    function getBlobMetadata(blobId: BlobId): Promise<CheckImageStoreValue> {
      return new Promise((resolve, reject) => {
        if (!isBlobId(blobId)) {
          const error = `[@metacentre/sharp] getMetadata(blobId: BlobId) arg is not a valid blobId: ${blobId}`
          reject(error)
        }
        store.get(blobId).then(data => {
          if (data) resolve({ found: true, metadata: data })
          else resolve({ found: false })
        })
      })
    }

    return { resize, makeSrcSet, process, getBlobMetadata }
  }
}

export = plugin
