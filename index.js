module.exports = async function makeIPFSFetch (opts = {}) {
  const { makeRoutedFetch } = await import('make-fetch')
  const {fetch, router} = makeRoutedFetch()
  const parseRange = require('range-parser')
  const mime = require('mime/lite')
  // const { CID } = require('multiformats/cid')
  const Busboy = require('busboy')
  const { Readable } = require('stream')
  const path = require('path')

  const DEFAULT_OPTS = {}
  const finalOpts = { ...DEFAULT_OPTS, ...opts }
  const app = await (async (finalOpts) => {if(finalOpts.ipfs){return finalOpts.ipfs}else{const IPFS = await import('ipfs-core');return await IPFS.create(finalOpts)}})(finalOpts)
  const check = await import('is-ipfs')
  const {CID} = (await import('multiformats/cid'))
  const ipfsTimeout = 30000
  const SUPPORTED_METHODS = ['GET', 'HEAD', 'POST', 'DELETE']
  const hostType = '_'

  function takeCareOfIt(data){
    console.log(data)
    throw new Error('aborted')
  }

  function sendTheData(theSignal, theData){
    if(theSignal){
      theSignal.removeEventListener('abort', takeCareOfIt)
    }
    return theData
  }

  function formatReq(hostname, pathname){

    pathname = decodeURIComponent(pathname)
    let query = null
    if(hostname === hostType){
      // const testQuery = pathname.slice(1)
      // const testSlash =  testQuery.indexOf('/')
      // const testFinal = testSlash !== -1 ? testQuery.slice(0, testSlash) : testQuery
      // if(check.cid(testFinal)){
      //   query = CID.parse(testQuery)
      // } else {
      //   query = pathname
      // }
      query = pathname
    } else {
      if(check.cid(hostname)){
        query = CID.parse(hostname)
      } else {
        query = `/${path.join(hostname, pathname).replace(/\\/g, "/")}`
      }
    }
    const firstSlash = pathname
    const lastSlash = pathname.slice(pathname.lastIndexOf('/'))
    return {query, mimeType: mime.getType(lastSlash), ext: lastSlash, fullPath: firstSlash}
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

  async function dirIter (iterable, main) {
    const result = []
    for await (const item of iterable) {
      item.cid = item.cid.toV1().toString()
      item.path = path.join(main, item.name).replace(/\\/g, "/")
      item.link = path.join('ipfs://', item.cid, item.name).replace(/\\/g, "/")
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
    // await Promise.all(saveIter)
    for(const test of saveIter){
      await test
    }
    return savePath
  }

  async function iterFiles(data, opts){
    const result = []
    for(const i of data){
      try {
        const useData = await app.files.stat(i, opts)
        const kind = i.slice(i.lastIndexOf('/'))
        useData.cid = useData.cid.toV1().toString()
        useData.host = 'ipfs://' + useData.cid
        useData.link = useData.host + kind
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
      useData.link = 'ipfs://' + useData.cid + kind
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

  async function handleHead(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }
    const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {query: main, mimeType: type, ext, fullPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
      const useTimeOut = (reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0') || (searchParams.has('x-timer') && searchParams.get('x-timer') !== '0') ? Number(reqHeaders['x-timer'] || searchParams.get('x-timer')) * 1000 : ipfsTimeout

      if (reqHeaders['x-load']) {
        const idForContent = main.toV1().toString()
        const pathToFile = JSON.parse(reqHeaders['x-load']) ? path.join(`/${idForContent}`, fullPath).replace(/\\/g, "/") : fullPath
        await app.files.write(pathToFile, app.files.read(main, { timeout: useTimeOut }), { timeout: useTimeOut, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false })
        return sendTheData(signal, { status: 200, headers: { 'X-Data': `${idForContent}`, 'Link': `<ipfs://${idForContent}${fullPath}>; rel="canonical"` }, body: [] })
      } else {
        const mainData = await app.files.stat(main, { timeout: useTimeOut })
        return sendTheData(signal, { status: 200, headers: { 'X-Data': `${mainData.cid.toV1().toString()}`, 'Link': `<ipfs://${mainData.cid.toV1().toString()}${ext}>; rel="canonical"`, 'Content-Length': `${mainData.size}` }, body: [] })
      }
  }

  async function handleGet(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {query: main, mimeType: type, ext, fullPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
      const useTimeOut = (reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0') || (searchParams.has('x-timer') && searchParams.get('x-timer') !== '0') ? Number(reqHeaders['x-timer'] || searchParams.get('x-timer')) * 1000 : ipfsTimeout

    const mainReq = !reqHeaders.accept || !reqHeaders.accept.includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

        let mainData = null
        try {
          mainData = await app.files.stat(main, {timeout: useTimeOut})
        } catch (error) {
          return sendTheData(signal, {status: 400, headers: {'Content-Type': mainRes, 'X-Issue': error.name}, body: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${error.stack}</div></body></html>`] : [JSON.stringify(error.stack)]})
        }
        if(mainData.type === 'directory'){
          const plain = await dirIter(app.files.ls(main, {timeout: useTimeOut}), main)
          return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes, 'Link': `<ipfs://${mainData.cid.toV1().toString()}/>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, body: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${plain.length ? plain.map((data) => {return `<p><a href="${data.path}">${data.path}</a></p><br/><p><a href="${data.link}">${data.link}</a></p>`}) : "<p>there isn't any data</p>"}</div></body></html>`] : [JSON.stringify(plain)]})
        } else if(mainData.type === 'file'){
          const isRanged = reqHeaders.Range || reqHeaders.range
          if(isRanged){
            const ranges = parseRange(mainData.size, isRanged)
            if (ranges && ranges.length && ranges.type === 'bytes') {
              const [{ start, end }] = ranges
              const length = (end - start + 1)
              return sendTheData(signal, {status: 206, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}${ext}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${length}`, 'Content-Range': `bytes ${start}-${end}/${mainData.size}`}, body: app.files.read(main, { offset: start, length, timeout: useTimeOut })})
            } else {
              return sendTheData(signal, {status: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}${ext}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${mainData.size}`}, body: app.files.read(main, { timeout: useTimeOut })})
            }
          } else {
            return sendTheData(signal, {status: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}${ext}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${mainData.size}`}, body: app.files.read(main, { timeout: useTimeOut })})
          }
        } else {
          throw new Error('not a directory or file')
        }
  }

  async function handlePost(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {query: main, mimeType: type, ext, fullPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
      const useTimeOut = (reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0') || (searchParams.has('x-timer') && searchParams.get('x-timer') !== '0') ? Number(reqHeaders['x-timer'] || searchParams.get('x-timer')) * 1000 : ipfsTimeout

    const mainReq = !reqHeaders.accept || !reqHeaders.accept.includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

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
          return sendTheData(signal, {status: 400, headers: {'Content-Type': mainRes, 'X-Issue': error.name}, body: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${error.message}</div></body></html>`] : [JSON.stringify(error.message)]})
        }

        return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes}, body: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>`] : [JSON.stringify(mainData)]})
  }

  async function handleDelete(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {query: main, mimeType: type, ext, fullPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
      const useTimeOut = (reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0') || (searchParams.has('x-timer') && searchParams.get('x-timer') !== '0') ? Number(reqHeaders['x-timer'] || searchParams.get('x-timer')) * 1000 : ipfsTimeout

    const mainReq = !reqHeaders.accept || !reqHeaders.accept.includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

    let mainData = null
    try {
      mainData = await app.files.stat(main, {timeout: useTimeOut})
      mainData.cid = mainData.cid.toV1().toString()
      mainData.id = mainData.cid
      mainData.link = 'ipfs://' + mainData.cid + ext
    } catch (error) {
      return sendTheData(signal, {status: 400, headers: {'Content-Type': mainRes, 'X-Issue': error.name}, body: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${error.message}</div></body></html>`] : [JSON.stringify(error.message)]})
    }
    if(mainData.type === 'directory'){
      await app.files.rm(main, {cidVersion: 1, recursive: true, timeout: useTimeOut})
    } else if(mainData.type === 'file'){
      await app.files.rm(main, {cidVersion: 1, timeout: useTimeOut})
    } else {
      throw new Error('not a directory or file')
    }

    return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes}, body: mainReq ? [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>`] : [JSON.stringify(mainData)]})
  }

  router.head('ipfs://*/**', handleHead)
  router.get('ipfs://*/**', handleGet)
  router.post('ipfs://*/**', handlePost)
  router.delete('ipfs://*/**', handleDelete)

  fetch.close = async () => {return await app.stop()}

  return fetch
}