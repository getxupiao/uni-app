const path = require('path')

const {
  md5,
  parseEntry,
  normalizePath
} = require('@dcloudio/uni-cli-shared')

const {
  pagesJsonJsFileName
} = require('@dcloudio/uni-cli-shared/lib/pages')

const generateApp = require('./generate-app')
const generateJson = require('./generate-json')
const generateComponent = require('./generate-component')

const emitFileCaches = {}

function emitFile (filePath, source, compilation) {
  const emitFileMD5 = md5(filePath + source)
  if (emitFileCaches[filePath] !== emitFileMD5) {
    emitFileCaches[filePath] = emitFileMD5
    compilation.assets[filePath] = {
      size () {
        return Buffer.byteLength(source, 'utf8')
      },
      source () {
        return source
      }
    }
  }
}

function addSubPackagesRequire (compilation) {
  if (!process.env.UNI_OPT_SUBPACKAGES) {
    return
  }
  const assetsKeys = Object.keys(compilation.assets)
  Object.keys(process.UNI_SUBPACKAGES).forEach(root => {
    const subPackageVendorPath = normalizePath(path.join(root, 'common/vendor.js'))
    if (assetsKeys.indexOf(subPackageVendorPath) !== -1) {
      // TODO 理论上仅需在分包第一个 js 中添加 require common vendor，但目前不同平台可能顺序不一致，
      // 故 每个分包里的 js 里均添加一次 require
      assetsKeys.forEach(name => {
        if (
          path.extname(name) === '.js' &&
          name.indexOf(root + '/') === 0 &&
          name !== subPackageVendorPath
        ) {
          const source =
            `require('${normalizePath(path.relative(path.dirname(name), subPackageVendorPath))}');` +
            compilation.assets[name].source()

          compilation.assets[name] = {
            size () {
              return Buffer.byteLength(source, 'utf8')
            },
            source () {
              return source
            }
          }
        }
      })
    }
  })
}

function addMPPluginRequire (compilation) {
  // 编译到小程序插件 特殊处理入口文件
  if (process.env.UNI_MP_PLUGIN) {
    const assetsKeys = Object.keys(compilation.assets)
    assetsKeys.forEach(name => {
      if (name === process.env.UNI_MP_PLUGIN_MAIN) {
        const modules = compilation.modules

        const mainFilePath = normalizePath(path.resolve(process.env.UNI_INPUT_DIR, process.env.UNI_MP_PLUGIN_MAIN))

        const uniModuleId = modules.find(module => module.resource && normalizePath(module.resource) === mainFilePath).id

        const newlineIndex = compilation.assets[name].source().lastIndexOf('\n')

        const source = compilation.assets[name].source().substring(0, newlineIndex) +
        `\nmodule.exports = wx.__webpack_require_${process.env.UNI_MP_PLUGIN.replace(/-/g, '_')}__('${uniModuleId}');\n` +
        compilation.assets[name].source().substring(newlineIndex + 1)

        compilation.assets[name] = {
          size () {
            return Buffer.byteLength(source, 'utf8')
          },
          source () {
            return source
          }
        }
      }
    })
  }
}

class WebpackUniMPPlugin {
  apply (compiler) {
    if (!process.env.UNI_USING_NATIVE && !process.env.UNI_USING_V3_NATIVE) {
      compiler.hooks.emit.tapPromise('webpack-uni-mp-emit', compilation => {
        return new Promise((resolve, reject) => {
          addSubPackagesRequire(compilation)

          addMPPluginRequire(compilation)

          generateJson(compilation)

          // app.js,app.wxss
          generateApp(compilation)
            .forEach(({
              file,
              source
            }) => emitFile(file, source, compilation))

          generateComponent(compilation, compiler.options.output.jsonpFunction)

          resolve()
        })
      })
    }
    compiler.hooks.invalid.tap('webpack-uni-mp-invalid', (fileName, changeTime) => {
      if (
        fileName &&
        typeof fileName === 'string'
      ) { // 重新解析 entry
        const basename = path.basename(fileName)
        const deps = process.UNI_PAGES_DEPS || new Set()
        if (
          basename === 'pages.json' ||
          basename === pagesJsonJsFileName ||
          deps.has(normalizePath(fileName))
        ) {
          try {
            parseEntry()
          } catch (e) {
            console.error(e)
          }
        }
      }
    })
  }
}

module.exports = WebpackUniMPPlugin
