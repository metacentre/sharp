import pull from 'pull-stream'

const plugin = {
  name: 'sharp',
  version: require('../package.json').version,
  manifest: {
    get: 'source'
  },
  init(rpc: any) {
    console.log('sharp plugin loaded')

    // prettier-ignore
    pull(
      pull.values([1, 2, 3,4,5]),
      pull.collect(console.log)

    )
  }
}

export = plugin
