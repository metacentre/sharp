import { BlobId } from 'ssb-typescript'

export interface MakeSrcSetOptions {
  blobId: BlobId
  sizes: number[]
  format: ImageFormat
}

export interface SharpResizeOptions {
  blobId: BlobId
  size: number
  format: ImageFormat
}

export type ImageFormat = 'webp' | 'avif' | 'png'
export type ImageMetadataItem = [ImageFormat, number, string]
export type ImageMetadata = [ImageMetadataItem]

export interface CheckImageStoreValue {
  found: boolean
  metadata: ImageMetadata[]
}
export interface StoreImageBlobProps {
  store: Keyv<any>
  id: BlobId
  format: ImageFormat
  filename: string
  size: number
}
export interface CheckImageStoreProps {
  store: Keyv<any>
  blobId: BlobId
  format: ImageFormat
  size: number
}
