/**
 * Metro configuration for React Native
 * https://github.com/facebook/react-native
 *
 * @format
 */

const { getDefaultConfig } = require('metro-config')
const exclusionList = require('metro-config/src/defaults/blacklist')

module.exports = (async () => {
  const {
    resolver: { sourceExts },
  } = await getDefaultConfig()
  return {
    resolver: {
      sourceExts: [...sourceExts, 'cjs'],
      blacklistRE: exclusionList([/android\/app\/build\/.*/]),
    },
    transformer: {
      getTransformOptions: async () => ({
        transform: {
          experimentalImportSupport: false,
          inlineRequires: false,
        },
      }),
    },
  }
})()
