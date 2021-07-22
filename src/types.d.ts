import { BlobId } from 'ssb-typescript'

export interface MakeSrcSetOptions {
  blobId: BlobId
  sizes: number[]
  format?: 'webp' | 'png'
}

export interface SharpResizeOptions {
  blobId: BlobId
  size?: number
  format?: 'webp' | 'png'
}
