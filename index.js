module.exports = async function makeIPFSFetch (opts = {}) {
  const { makeRoutedFetch } = await import('make-fetch')
  const {fetch, router} = makeRoutedFetch({onNotFound: handleEmpty, onError: handleError})
  const parseRange = require('range-parser')
  const mime = require('mime/lite')
  // const { CID } = require('multiformats/cid')
  const { Readable } = require('streamx')
  const path = require('path')

  const DEFAULT_OPTS = {}
  const finalOpts = { ...DEFAULT_OPTS, ...opts }
  const app = await (async (finalOpts) => {if(finalOpts.ipfs){return finalOpts.ipfs}else{const IPFS = await import('ipfs-core');return await IPFS.create(finalOpts)}})(finalOpts)
  const check = await import('is-ipfs')
  const {CID} = await import('multiformats/cid')
  const ipfsTimeout = 30000
  // const SUPPORTED_METHODS = ['GET', 'HEAD', 'POST', 'DELETE']
  const hostType = '_'

  function handleEmpty(request) {
    const { url, headers: reqHeaders, method, body, signal } = request
    if(signal){
      signal.removeEventListener('abort', takeCareOfIt)
    }
    const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
    return {status: 400, headers: { 'Content-Type': mainRes }, body: mainReq ? `<html><head><title>${url}</title></head><body><div><p>did not find any data</p></div></body></html>` : JSON.stringify('did not find any data')}
  }

  function handleError(e, request) {
    const { url, headers: reqHeaders, method, body, signal } = request
    if(signal){
      signal.removeEventListener('abort', takeCareOfIt)
    }
    const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'
    return {status: 500, headers: { 'X-Error': e.name, 'Content-Type': mainRes }, body: mainReq ? `<html><head><title>${e.name}</title></head><body><div><p>${e.stack}</p></div></body></html>` : JSON.stringify(e.stack)}
  }

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

  function handleFormData(formdata) {
    const arr = []
    for (const [name, info] of formdata) {
      if (name === 'file') {
        arr.push(info)
      }
    }
    return arr
  }

  function formatReq(hostname, pathname){

    pathname = decodeURIComponent(pathname)
    let query = null
    let cid = false
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
        cid = true
      } else {
        query = `/${path.join(hostname, pathname).replace(/\\/g, "/")}`
      }
    }
    const firstSlash = pathname
    const lastSlash = pathname.slice(pathname.lastIndexOf('/'))
    return {query, mimeType: mime.getType(lastSlash), ext: lastSlash, fullPath: firstSlash, cid}
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
      item.link = item.type === 'file' ? path.join('ipfs://', item.cid, item.name).replace(/\\/g, "/") : path.join('ipfs://', item.cid).replace(/\\/g, "/")
      result.push(item)
    }
    return result
  }

  async function saveFormData(pathTo, data, useOpts) {
    const saved = []
    for (const info of data) {
      const usePath = path.join(pathTo, info.name).replace(/\\/g, "/")
      await app.files.write(usePath, Readable.from(info.stream()), useOpts)
      saved.push(usePath)
    }
    return saved
  }

  async function saveFileData(pathTo, data, useOpts) {
    await app.files.write(pathTo, Readable.from(data), useOpts)
    return [pathTo]
  }

  async function handleHead(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }
    const { hostname, pathname, protocol, search, searchParams } = new URL(url)

    const { query: main, mimeType: type, ext, fullPath, cid } = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
    const useOpts = { timeout: reqHeaders.has('x-timer') || searchParams.has('x-timer') ? reqHeaders.get('x-timer') !== '0' || searchParams.get('x-timer') !== '0' ? Number(reqHeaders.get('x-timer') || searchParams.get('x-timer')) * 1000 : undefined : ipfsTimeout }

      if (reqHeaders.has('x-copy')) {
        const idForContent = main.toV1().toString()
        const pathToFile = JSON.parse(reqHeaders.get('x-copy')) ? path.join(`/${idForContent}`, fullPath).replace(/\\/g, "/") : fullPath
        await app.files.write(pathToFile, app.files.read(main, { ...useOpts }), { cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false, ...useOpts })
        const useLink = path.join('ipfs://', idForContent, ext).replace(/\\/g, "/")
        return sendTheData(signal, { status: 200, headers: { 'X-Data': `${idForContent}`, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"` }, body: '' })
      } else {
        try {
          const mainData = await app.files.stat(main, useOpts)
          if (mainData.type === 'directory') {
            // const useLink = cid ? `${path.join('ipfs://', mainData.cid.toV1().toString(), '/').replace(/\\/g, "/")}` : `${path.join('ipfs://', main, '/').replace(/\\/g, "/")}`
            const useLink = `${path.join('ipfs://', mainData.cid.toV1().toString(), '/').replace(/\\/g, "/")}`
            return sendTheData(signal, { status: 200, headers: { 'X-Data': `${mainData.cid.toV1().toString()}`, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Length': `${mainData.size}` }, body: '' })
          } else if (mainData.type === 'file') {
            // const useLink = cid ? `${path.join('ipfs://', mainData.cid.toV1().toString(), ext).replace(/\\/g, "/")}` : `${path.join('ipfs://', main).replace(/\\/g, "/")}`
            const useLink = `${path.join('ipfs://', mainData.cid.toV1().toString(), ext).replace(/\\/g, "/")}`
            return sendTheData(signal, { status: 200, headers: { 'X-Data': `${mainData.cid.toV1().toString()}`, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Length': `${mainData.size}` }, body: '' })
          } else {
            return sendTheData(signal, { status: 400, headers: {'X-Error': error.name} , body: ''})
          }
        } catch (error) {
          return sendTheData(signal, { status: 400, headers: {'X-Error': error.name} , body: ''})
        }
      }
  }

  async function handleGet(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

    const { query: main, mimeType: type, ext, fullPath, cid } = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
    const useOpts = { timeout: reqHeaders.has('x-timer') || searchParams.has('x-timer') ? reqHeaders.get('x-timer') !== '0' || searchParams.get('x-timer') !== '0' ? Number(reqHeaders.get('x-timer') || searchParams.get('x-timer')) * 1000 : undefined : ipfsTimeout }

    const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

    try {
      const mainData = await app.files.stat(main, useOpts)
      if(mainData.type === 'directory'){
        const plain = await dirIter(app.files.ls(main, useOpts), main)
        // const useLink = cid ? `${path.join('ipfs://', mainData.cid.toV1().toString(), '/').replace(/\\/g, "/")}` : `${path.join('ipfs://', main, '/').replace(/\\/g, "/")}`
        const useLink = `${path.join('ipfs://', mainData.cid.toV1().toString(), '/').replace(/\\/g, "/")}`
        return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, body: mainReq ? `<html><head><title>Fetch</title></head><body><div>${plain.length ? plain.map((data) => {return `<p><a href="${data.path}">${data.path}</a></p><br/><p><a href="${data.link}">${data.link}</a></p>`}) : "<p>there isn't any data</p>"}</div></body></html>` : JSON.stringify(plain)})
      } else if(mainData.type === 'file'){
        const isRanged = reqHeaders.has('Range') || reqHeaders.has('range')
        // const useLink = cid ? `${path.join('ipfs://', mainData.cid.toV1().toString(), ext).replace(/\\/g, "/")}` : `${path.join('ipfs://', main).replace(/\\/g, "/")}`
        const useLink = `${path.join('ipfs://', mainData.cid.toV1().toString(), ext).replace(/\\/g, "/")}`
        if(isRanged){
          const ranges = parseRange(mainData.size, reqHeaders.get('Range') || reqHeaders.get('range'))
          if (ranges && ranges.length && ranges.type === 'bytes') {
            const [{ start, end }] = ranges
            const length = (end - start + 1)
            return sendTheData(signal, {status: 206, headers: {'X-Link': `${useLink}`, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${length}`, 'Content-Range': `bytes ${start}-${end}/${mainData.size}`}, body: app.files.read(main, { ...useOpts, offset: start, length })})
          } else {
            return sendTheData(signal, {status: 416, headers: {'X-Link': `${useLink}`, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Type': mainRes, 'Content-Length': `${mainData.size}`}, body: mainReq ? '<html><head><title>range</title></head><body><div><p>malformed or unsatisfiable range</p></div></body></html>' : JSON.stringify('malformed or unsatisfiable range')})
          }
        } else {
          return sendTheData(signal, {status: 200, headers: {'X-Link': `${useLink}`, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${mainData.size}`}, body: app.files.read(main, { ...useOpts })})
        }
        } else {
          return sendTheData(signal, { status: 400, headers: { 'Content-Type': mainRes }, body: mainReq ? '<html><head><title>range</title></head><body><div><p>did not find any file</p></div></body></html>' : JSON.stringify('did not find any file') })
        }
    } catch (error) {
      return sendTheData(signal, { status: 400, headers: {'X-Error': error.name, 'Content-Type': mainRes} , body: mainReq ? '<html><head><title>range</title></head><body><div><p>did not find any data</p></div></body></html>' : JSON.stringify('did not find any data')})
    }
  }

  async function handlePost(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {query: main, mimeType: type, ext, fullPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))

      const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
      const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

      const useOpt = reqHeaders.has('x-opt') || searchParams.has('x-opt') ? JSON.parse(reqHeaders.get('x-opt') || decodeURIComponent(searchParams.get('x-opt'))) : {}
      const saved = reqHeaders.has('content-type') && reqHeaders.get('content-type').includes('multipart/form-data') ? await saveFormData(main, handleFormData(await request.formData()), {...useOpt, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false}) : await saveFileData(main, body, {...useOpt, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false})

      return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes}, body: mainReq ? `<html><head><title>Fetch</title></head><body><div>${JSON.stringify(saved)}</div></body></html>` : JSON.stringify(saved)})
  }

  async function handleDelete(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {query: main, mimeType: type, ext, fullPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))

    const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

      const mainData = await app.files.stat(main, {})
      mainData.cid = mainData.cid.toV1().toString()
      mainData.id = mainData.cid
      mainData.link = 'ipfs://' + mainData.cid + ext
    if(mainData.type === 'directory'){
      await app.files.rm(main, {cidVersion: 1, recursive: true})
    } else if(mainData.type === 'file'){
      await app.files.rm(main, {cidVersion: 1})
    } else {
      throw new Error('not a directory or file')
    }

    return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes}, body: mainReq ? `<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>` : JSON.stringify(mainData)})
  }

  router.head('ipfs://*/**', handleHead)
  router.get('ipfs://*/**', handleGet)
  router.post('ipfs://*/**', handlePost)
  router.delete('ipfs://*/**', handleDelete)

  fetch.close = async () => {return await app.stop()}

  return fetch
}