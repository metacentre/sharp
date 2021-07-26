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
import { MakeSrcSetOptions, SharpResizeOptions } from './types'
import { haveBlob, findKeyInObject } from './utils'
// import Keyv from 'keyv'
// import { KeyvFile } from 'keyv-file'

const debug = Debug('plugins:sharp')
const pkg = require('../package.json')

const plugin = {
  name: 'sharp',
  version: require('../package.json').version,
  manifest: {
    resize: 'async',
    makeSrcSet: 'source',
    process: 'sync'
  },
  init(rpc: any, config: any) {
    debug(`[${pkg.name} v${pkg.version}] init`)

    const imageDir = join(config.path, 'sharp', 'images')
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

    // const store = new Keyv({
    //   store: new KeyvFile({
    //     filename: join(imageDir, 'store.json'),
    //     expiredCheckDelay: 24 * 3600 * 1000, // ms, check and remove expired data in each ms
    //     writeDelay: 100, // ms, batch write to disk in a specific duration, enhance write performance.
    //     encode: JSON.stringify, // serialize function
    //     decode: JSON.parse // deserialize function
    //   })
    // })
    // store.on('error', error =>
    //   console.log(
    //     '[@metacentre/sharp] Error connecting to persistent keyv store',
    //     error
    //   )
    // )

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

      const blobFound = await haveBlob(rpc, blobId)
      if (!blobFound) {
        /** ask for the missing blob and continue */
        rpc.blobs.want(blobId)
        const msg = `Blob ${blobId} not found. Asking peers for it...`
        debug(msg)
        return cb(msg)
      }

      const bufferStream: Source<Uint8Array[]> = rpc.blobs.get(blobId)
      if (!bufferStream)
        return cb(`[@metacentre/sharp] Error getting blob ${blobId}...`)

      const filename = `${base32.encode(blobId)}.${size}.${format}`

      const transform = (bufferArray: Uint8Array[]) => {
        if (format === 'webp')
          return sharp(Buffer.concat(bufferArray))
            .resize(Number(size), Number(size))
            .webp()
        if (format === 'avif')
          return sharp(Buffer.concat(bufferArray))
            .resize(Number(size), Number(size))
            .avif()
        if (format === 'png')
          return sharp(Buffer.concat(bufferArray))
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
                  writeFile(join(imageDir, filename), imgBuffer, error => {
                    if (error) {
                      const errorMsg = `[@metacentre/sharp] Error writing transformed image to disk ${error}`
                      return cb(errorMsg)
                    }
                    cb(null, { id: blobId, filename, size })
                    console.log(
                      `Successfully transformed ${blobId} to ${size}px and wrote to ${filename}`
                    )
                  })
                })
                .catch((error: any) =>
                  console.log(
                    `[@metacentre/sharp] error transforming image buffer ${error}`
                  )
                )
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

    return { resize, makeSrcSet, process }
  }
}

export = plugin
