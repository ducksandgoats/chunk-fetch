const makeFetch = require('make-fetch')
const parseRange = require('range-parser')
const mime = require('mime/lite')
const { CID } = require('multiformats/cid')
const Busboy = require('busboy')
const { Readable } = require('stream')
const path = require('path')

module.exports = async function makeIPFSFetch (opts = {}) {
  const DEFAULT_OPTS = {}
  const finalOpts = { ...DEFAULT_OPTS, ...opts }
  const app = await (async (finalOpts) => {if(finalOpts.ipfs){return finalOpts.ipfs}else{const IPFS = await import('ipfs-core');return await IPFS.create(finalOpts)}})(finalOpts)
  const ipfsTimeout = 30000
  const SUPPORTED_METHODS = ['GET', 'HEAD', 'POST', 'DELETE']
  const encodeType = 'hex'
  const hostType = '_'

  function formatReq(hostname, pathname){

    pathname = decodeURIComponent(pathname)
    let query = null
    if(hostname === hostType){
      query = pathname
    } else {
      try {
        query = CID.parse(hostname)
      } catch (err) {
        console.error(err.name)
        query = `/${path.join(hostname, pathname).replace(/\\/g, "/")}`
      }
    }
    const lastSlash = pathname.slice(pathname.lastIndexOf('/')).slice(1)
    return {query, mimeType: mime.getType(lastSlash), ext: lastSlash.indexOf('.') !== -1 ? lastSlash.slice(lastSlash.indexOf('.')) : ''}
  }

  // function getMime (path) {
  //   let mimeType = mime.getType(path)
  //   if (mimeType && mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
  //   return mimeType
  // }

  // async function collect (iterable) {
  //   const result = []
  //   for await (const item of iterable) {
  //     result.push(item)
  //   }
  // }

  async function dirIter (iterable) {
    const result = []
    for await (const item of iterable) {
      const ext = item.type === 'file' && item.name.includes('.') ? item.name.slice(item.name.indexOf('.')) : ''
      item.cid = item.cid.toV1().toString()
      item.host = 'ipfs://' + item.cid
      item.link = 'ipfs://' + item.cid + '/' + ext
      result.push(item)
    }
    return result
  }

  async function saveFormData (pathTo, content, useHeaders, useOpts) {
    const {savePath, saveIter} = await new Promise((resolve, reject) => {
      const savePath = []
      const saveIter = []
      const busboy = Busboy({ headers: useHeaders })

      function handleOff(){
        busboy.off('error', handleError)
        busboy.off('finish', handleFinish)
        busboy.off('file', handleFiles)
      }
      function handleFinish(){
        handleOff()
        resolve({savePath, saveIter})
      }
      function handleError(error){
        handleOff()
        reject(error)
      }
      function handleFiles(fieldName, fileData, info){
        const usePath = path.join(pathTo, info.filename).replace(/\\/g, "/")
        savePath.push(usePath)
        saveIter.push(app.files.write(usePath, Readable.from(fileData), useOpts))
      }
      busboy.on('error', handleError)
      busboy.on('finish', handleFinish)

      busboy.on('file', handleFiles)
  
      // Parse body as a multipart form
      // TODO: Readable.from doesn't work in browsers
      Readable.from(content).pipe(busboy)
    })

    // toUpload is an async iterator of promises
    // We collect the promises (all files are queued for upload)
    // Then we wait for all of them to resolve
    // await Promise.all(await collect(toUpload))
    await Promise.all(saveIter)
    return savePath
  }

  async function iterFiles(data, opts){
    const result = []
    for(const i of data){
      try {
        const useData = await app.files.stat(i, opts)
        const kind = i.includes('.') ? i.slice(i.indexOf('.')) : ''
        useData.cid = useData.cid.toV1().toString()
        useData.host = 'ipfs://' + useData.cid
        useData.link = useData.host + '/' + kind
        useData.file = i
        result.push(useData)
      } catch (err){
        console.error(err)
        const useData = {error: err}
        useData.file = i
        result.push(useData)
      }
    }
    return result
  }

  async function iterFile(data, kind, opts){
    const result = []
    try {
      const useData = await app.files.stat(data, opts)
      useData.cid = useData.cid.toV1().toString()
      useData.link = 'ipfs://' + useData.cid + '/' + kind
      useData.file = i
      result.push(useData)
    } catch (err) {
      console.error(err)
      const useData = {error: err}
      useData.file = i
      result.push(useData)
    }
    return result
  }

  // async function fileIter(iterable, tag){
  //   // let result = null
  //   let result = ''
  //   if(tag){
  //     // result = ''
  //     for await (const i of iterable){
  //       result += i.toString('base64')
  //     }
  //   } else {
  //     // result = ''
  //     for await (const i of iterable){
  //       result += i.toString()
  //     }
  //   }
  //   return result
  // }

  const fetch = makeFetch(async (request) => {

    const { url, headers: reqHeaders, method, body } = request
    
    try {
      const { hostname, pathname, protocol, search, searchParams } = new URL(url)
      const mainHostname = hostname && hostname.startsWith(encodeType) ? Buffer.from(hostname.slice(encodeType.length), 'hex').toString('utf-8') : hostname

      if (protocol !== 'ipfs:') {
        return { statusCode: 409, headers: {}, data: ['wrong protocol'] }
      } else if (!method || !SUPPORTED_METHODS.includes(method)) {
        return { statusCode: 409, headers: {}, data: ['something wrong with method'] }
      } else if ((!mainHostname) || ((mainHostname.length === 1) && (pathname.split('/').filter(Boolean).length > 1 || mainHostname !== hostType))) {
        return { statusCode: 409, headers: {}, data: ['something wrong with hostname'] }
      }

      const {query: main, mimeType: type, ext} = formatReq(decodeURIComponent(mainHostname), decodeURIComponent(pathname))
      const useTimeOut = (reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0') || (searchParams.has('x-timer') && searchParams.get('x-timer') !== '0') ? Number(reqHeaders['x-timer'] || searchParams.get('x-timer')) * 1000 : ipfsTimeout

      const mainReq = !reqHeaders.accept || !reqHeaders.accept.includes('application/json')
      const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

      if(method === 'HEAD'){
        try {
          if(reqHeaders['x-pin'] && reqHeaders['x-pin'] === 'true'){
            const mainData = await app.pin.add(main, {timeout: useTimeOut})
            return {statusCode: 200, headers: {'X-Data': `${mainData.cid.toV1().toString()}`, 'Link': `<ipfs://${mainData.cid.toV1().toString()}/${ext}>; rel="canonical"`}, data: []}
          } else if(reqHeaders['x-unpin'] && reqHeaders['x-unpin'] === 'true'){
            const mainData = await app.pin.rm(main, {timeout: useTimeOut})
            return {statusCode: 200, headers: {'X-Data': `${mainData.cid.toV1().toString()}`, 'Link': `<ipfs://${mainData.cid.toV1().toString()}/${ext}>; rel="canonical"`}, data: []}
          } else {
            const mainData = await app.files.stat(main, {timeout: useTimeOut})
            return {statusCode: 200, headers: {'X-Data': `${mainData.cid.toV1().toString()}`, 'Link': `<ipfs://${mainData.cid.toV1().toString()}/${ext}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, data: []}
          }
        } catch (error) {
          return {statusCode: 400, headers: {'X-Issue': error.name}, data: []}
        }
      } else if(method === 'GET'){
        let mainData = null
        try {
          mainData = await app.files.stat(main, {timeout: useTimeOut})
        } catch (error) {
          return {statusCode: 400, headers: {'Content-Type': mainRes, 'X-Issue': error.name}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${error.stack}</div></body></html>`] : [JSON.stringify(error.stack)]}
        }
        if(mainData.type === 'directory'){
          const plain = await dirIter(app.files.ls(main, {timeout: useTimeOut}))
          return {statusCode: 200, headers: {'Content-Type': mainRes, 'Link': `<ipfs://${mainData.cid.toV1().toString()}/>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(plain)}</div></body></html>`] : [JSON.stringify(plain)]}
        } else if(mainData.type === 'file'){
          const isRanged = reqHeaders.Range || reqHeaders.range
          if(isRanged){
            const ranges = parseRange(mainData.size, isRanged)
            if (ranges && ranges.length && ranges.type === 'bytes') {
              const [{ start, end }] = ranges
              const length = (end - start + 1)
              return {statusCode: 206, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}/${ext}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${length}`, 'Content-Range': `bytes ${start}-${end}/${mainData.size}`}, data: app.files.read(main, { offset: start, length, timeout: useTimeOut })}
            } else {
              return {statusCode: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}/${ext}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${mainData.size}`}, data: app.files.read(main, { timeout: useTimeOut })}
            }
          } else {
            return {statusCode: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}/${ext}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${mainData.size}`}, data: app.files.read(main, { timeout: useTimeOut })}
          }
        } else {
          throw new Error('not a directory or file')
        }
      } else if(method === 'POST'){
        let mainData = null
        try {
          const hasOpt = reqHeaders['x-opt'] || searchParams.has('x-opt')
          const useOpt = hasOpt ? JSON.parse(reqHeaders['x-opt'] || decodeURIComponent(searchParams.get('x-opt'))) : {}
          if(reqHeaders['content-type'] && reqHeaders['content-type'].includes('multipart/form-data')){
            mainData = await iterFiles(await saveFormData(main, body, reqHeaders, {...useOpt, timeout: useTimeOut, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false}), {timeout: useTimeOut})
          } else {
            await app.files.write(main, body, {...useOpt, timeout: useTimeOut, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false})
            mainData = await iterFile(main, ext, {timeout: useTimeOut})
          }
        } catch (error) {
          return {statusCode: 400, headers: {'Content-Type': mainRes, 'X-Issue': error.name}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${error.message}</div></body></html>`] : [JSON.stringify(error.message)]}
        }
        return {statusCode: 200, headers: {'Content-Type': mainRes}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>`] : [JSON.stringify(mainData)]}
      } else if(method === 'DELETE'){
        let mainData = null
        try {
          mainData = await app.files.stat(main, {timeout: useTimeOut})
          mainData.cid = mainData.cid.toV1().toString()
          mainData.link = 'ipfs://' + mainData.cid + '/'
        } catch (error) {
          return {statusCode: 400, headers: {'Content-Type': mainRes, 'X-Issue': error.name}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${error.message}</div></body></html>`] : [JSON.stringify(error.message)]}
        }
        if(mainData.type === 'directory'){
          await app.files.rm(main, {cidVersion: 1, recursive: true, timeout: useTimeOut})
        } else if(mainData.type === 'file'){
          await app.files.rm(main, {cidVersion: 1, timeout: useTimeOut})
        } else {
          throw new Error('not a directory or file')
        }
        return {statusCode: 200, headers: {'Content-Type': mainRes}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>`] : [JSON.stringify(mainData)]}
      } else {
        return {statusCode: 400, headers: {'Content-Type': mainRes}, data: mainReq ? [`<html><head><title>Fetch</title></head><body><div>wrong method</div></body></html>`] : [JSON.stringify('wrong method')]}
      }
    } catch (error) {
      const mainReq = !reqHeaders.accept || !reqHeaders.accept.includes('application/json')
      const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
      return {statusCode: 500, headers: {'Content-Type': mainRes}, data: mainReq ? [`<html><head><title>${error.name}</title></head><body><div><p>${error.stack}</p></div></body></html>`] : [JSON.stringify(error.stack)]}
    }
  })

  fetch.close = async () => {return await app.stop()}

  return fetch
}