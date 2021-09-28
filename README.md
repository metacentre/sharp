# Config

Sharp key under ssb config. In `~/.ssb/config`

`format` and `sizes` is used by `sharp.process(data)`

`serve` if you wish to have this plugin serve the `~/.ssb/sharp/images` directory. Requires [ssb-ws](https://github.com/ssbc/ssb-ws) to be installed on your secret-stack. They are served on your `ssb-ws` port (default 8989) at `/sharp/images`

```json
{
  "sharp": {
    "format": "webp",
    "sizes": [128, 640, 768, 1024, 1366, 1600, 1920],
    "serve": {
      "ws": true
    }
  }
}
```

# API

```js
sbot.sharp.getBlobMetadata(blobId)
```

Returns a promise that resolves to a `{ found, metadata? }` object.

Metadata is an array of triples of the form `[format, size, filename]`. Filename is the [base32](https://www.npmjs.com/package/base32) encoding of a standard ssb blobId with size and format:

```js
const filename = `${base32Id}.${size}.${format}`
```

Successful query looks something like this:

```js
{
  found: true
  metadata: [
    ['webp', 128, 'kdauydkfmrjhaiydhgc5t64nvk99b7jd27e1348cv4c51p6uudanmk8t1t9hk4pj9x5ttpgr9j6mv0.128.webp'],
    ['webp', 640, 'kdauydkfmrjhaiydhgc5t64nvk99b7jd27e1348cv4c51p6uudanmk8t1t9hk4pj9x5ttpgr9j6mv0.640.webp'],
    ['webp', 768, 'kdauydkfmrjhaiydhgc5t64nvk99b7jd27e1348cv4c51p6uudanmk8t1t9hk4pj9x5ttpgr9j6mv0.768.webp']
  ]
}
```
