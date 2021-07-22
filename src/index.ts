const plugin = {
  name: 'sharp',
  version: require('../package.json').version,
  manifest: {},
  init(rpc: any) {
    console.log('sharp plugin loaded')
  }
}

export = plugin
