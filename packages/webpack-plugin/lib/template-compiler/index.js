const compiler = require('./compiler')
const bindThis = require('./bind-this').transform
const parseRequest = require('../utils/parse-request')
const matchCondition = require('../utils/match-condition')
const path = require('path')

module.exports = function (raw) {
  this.cacheable()
  const { resourcePath, queryObj } = parseRequest(this.resource)
  const mpx = this.getMpx()
  const mode = mpx.mode
  const env = mpx.env
  const defs = mpx.defs
  const i18n = mpx.i18n
  const externalClasses = mpx.externalClasses
  const decodeHTMLText = mpx.decodeHTMLText
  const globalSrcMode = mpx.srcMode
  const localSrcMode = queryObj.mode
  const packageName = queryObj.packageName || mpx.currentPackageRoot || 'main'
  const componentsMap = mpx.componentsMap[packageName]
  const wxsContentMap = mpx.wxsContentMap
  const usingComponents = queryObj.usingComponents
  const hasComment = queryObj.hasComment
  const isNative = queryObj.isNative
  const hasScoped = queryObj.hasScoped
  const moduleId = queryObj.moduleId

  const warn = (msg) => {
    this.emitWarning(
      new Error('[template compiler][' + this.resource + ']: ' + msg)
    )
  }

  const error = (msg) => {
    this.emitError(
      new Error('[template compiler][' + this.resource + ']: ' + msg)
    )
  }

  const parsed = compiler.parse(raw, {
    warn,
    error,
    usingComponents,
    hasComment,
    isNative,
    basename: path.basename(resourcePath),
    isComponent: !!componentsMap[resourcePath],
    mode,
    env,
    srcMode: localSrcMode || globalSrcMode,
    defs,
    decodeHTMLText,
    externalClasses,
    hasScoped,
    moduleId,
    filePath: this.resourcePath,
    i18n,
    checkUsingComponents: mpx.checkUsingComponents,
    globalComponents: Object.keys(mpx.usingComponents),
    forceProxyEvent: matchCondition(this.resourcePath, mpx.forceProxyEventRules)
  })

  let ast = parsed.root
  let meta = parsed.meta

  if (meta.wxsContentMap) {
    for (let module in meta.wxsContentMap) {
      wxsContentMap[`${resourcePath}~${module}`] = meta.wxsContentMap[module]
    }
  }

  let result = compiler.serialize(ast)

  if (isNative || mpx.forceDisableInject) {
    return result
  }

  const rawCode = `
global.currentInject = {
  moduleId: ${JSON.stringify(moduleId)},
  render: function () {
    ${compiler.genNode(ast)}
    this._r();
  }
};\n`

  let bindResult

  try {
    bindResult = bindThis(rawCode, {
      needCollect: true,
      ignoreMap: meta.wxsModuleMap
    })
  } catch (e) {
    error(`
Invalid render function generated by the template, please check!\n
Template result:
${result}\n
Error code:
${rawCode}
Error Detail:
${e.stack}`)
    return result
  }

  // todo 此处在loader中往其他模块addDep更加危险，考虑修改为通过抽取后的空模块的module.exports来传递信息
  let resultSource = bindResult.code + '\n'

  if (mode === 'tt' && bindResult.propKeys) {
    resultSource += `global.currentInject.propKeys = ${JSON.stringify(bindResult.propKeys)};\n`
  }

  if (meta.computed) {
    resultSource += bindThis(`
global.currentInject.injectComputed = {
  ${meta.computed.join(',')}
};`).code + '\n'
  }

  if (meta.refs) {
    resultSource += `
global.currentInject.getRefsData = function () {
  return ${JSON.stringify(meta.refs)};
};\n`
  }

  this.emitFile(file, '', undefined, {
    skipEmit: true,
    extractedResultSource: resultSource
  })

  // todo 处理wxs模块
  // for (let module in meta.wxsModuleMap) {
  //   isSync = false
  //   const src = loaderUtils.urlToRequest(meta.wxsModuleMap[module], root)
  //   // 编译render函数只在mpx文件中运行，此处issuer的context一定等同于当前loader的context
  //   const expression = `require(${loaderUtils.stringifyRequest(this, src)})`
  //   const deps = []
  //   parser.parse(expression, {
  //     current: {
  //       addDependency: dep => {
  //         dep.userRequest = module
  //         deps.push(dep)
  //       }
  //     },
  //     module: issuer
  //   })
  //   issuer.addVariable(module, expression, deps)
  //   iterationOfArrayCallback(deps, addDependency)
  // }

  return result
}
