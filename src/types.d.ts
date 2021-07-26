import { BlobId } from 'ssb-typescript'

export interface MakeSrcSetOptions {
  blobId: BlobId
  sizes: number[]
  format?: 'webp' | 'avif' | 'png'
}

export interface SharpResizeOptions {
  blobId: BlobId
  size: number
  format: 'webp' | 'avif' | 'png'
}
