module.exports = async function makeIPFSFetch (opts = {}) {
  const { makeRoutedFetch } = await import('make-fetch')
  const {fetch, router} = makeRoutedFetch({onNotFound: handleEmpty, onError: handleError})
  const parseRange = require('range-parser')
  const mime = require('mime/lite')
  // const { CID } = require('multiformats/cid')
  const { Readable } = require('streamx')
  const path = require('path')
  const {uid} = require('uid')

  const DEFAULT_OPTS = {}
  const finalOpts = { ...DEFAULT_OPTS, ...opts }
  const hostType = '_'
  const app = await (async () => { if (finalOpts.ipfs) { return finalOpts.ipfs } else { const IPFS = await import('ipfs-core'); return await IPFS.create(finalOpts) } })()
  await (async () => { try { await app.files.stat(`/${hostType}`, {}); } catch (error) { console.error(error); await app.files.mkdir(`/${hostType}`, {cidVersion: 1, parents:  true}); await app.files.write(`/${hostType}/welcome.txt`, 'this is your user directory', {cidVersion: 1, parents: true, create: true}); }})()
  const check = await import('is-ipfs')
  const {CID} = await import('multiformats/cid')
  const ipfsTimeout = 30000
  // const SUPPORTED_METHODS = ['GET', 'HEAD', 'POST', 'DELETE']

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
    let isCID
    if (check.cid(hostname)) {
      isCID = true
    } else {
      isCID = false
    }
    const lastSlash = pathname.slice(pathname.lastIndexOf('/'))
    const slashHost = path.join('/', hostname).replace(/\\/g, '/')
    const slashPath = pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, pathname.lastIndexOf('/')) : pathname
    return {mimeType: mime.getType(lastSlash), slashHost, slashPath, fullHost: hostname , ext: lastSlash, fullPath: pathname, isCID}
  }

  function makeQuery(cid, hostname, slashhost, slashpath) {
    if (cid) {
      return CID.parse(hostname)
    } else {
      return path.join(slashhost, slashpath).replace(/\\/g, '/')
    }
  }

  function genDir(id, data) {
    if (id) {
      const test = path.join(`/${uid(20)}`, data).replace(/\\/g, "/")
      return test.endsWith('/') ? test.slice(0, test.lastIndexOf('/')) : test
    } else {
      return data
    }
  }

  // function takeLastSlash(data) {
  //   return data.endsWith('/') ? data.slice(0, -1) : data
  // }

  function takeFirstSlash(data) {
    return data.startsWith('/') ? data.replace('/') : data
  }

  // function makeLink(data, extra, isCID, isHost) {

  // }

  // function makeLink(main, data) {
  //   return path.join('ipfs://', main, data)
  // }

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
      item.cid = item.cid.toV1().toString()
      item.link = item.type === 'file' ? 'ipfs://' + path.join(item.cid, item.name).replace(/\\/g, "/") : 'ipfs://' + path.join(item.cid, '/').replace(/\\/g, "/")
      result.push(item)
    }
    return result
  }

  async function saveFormData(saveHost, savePath, data, useOpts) {
    for (const info of data) {
      await app.files.write(path.join(saveHost, savePath, info.name).replace(/\\/g, "/"), Readable.from(info.stream()), useOpts)
    }
    return savePath
  }

  async function saveFileData(saveHost, savePath, data, useOpts) {
    await app.files.write(path.join(saveHost, savePath).replace(/\\/g, "/"), Readable.from(data), useOpts)
    return savePath
  }

  async function handleHead(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }
    const { hostname, pathname, protocol, search, searchParams } = new URL(url)

    const { mimeType: type, ext, fullHost, fullPath, isCID, slashHost, slashPath } = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
    const useOpts = { timeout: reqHeaders.has('x-timer') || searchParams.has('x-timer') ? reqHeaders.get('x-timer') !== '0' || searchParams.get('x-timer') !== '0' ? Number(reqHeaders.get('x-timer') || searchParams.get('x-timer')) * 1000 : undefined : ipfsTimeout }

    if (reqHeaders.has('x-copy') || searchParams.has('x-copy')) {
      const pathToData = genDir(JSON.parse(reqHeaders.get('x-copy') || searchParams.get('x-copy')), slashPath)
      await app.files.cp(makeQuery(isCID, fullHost, slashHost, slashPath), pathToData, { ...useOpts, cidVersion: 1, parents: true })
      const useLink = 'ipfs://' + takeFirstSlash(pathToData).replace(/\\/g, "/")
      return sendTheData(signal, { status: 200, headers: { 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"` }, body: '' })
    } else {
      try {
        const mainData = await app.files.stat(makeQuery(isCID, fullHost, slashHost, slashPath), useOpts)
        const useLink = mainData.type === 'directory' ? 'ipfs://' + path.join(mainData.cid.toV1().toString(), '/').replace(/\\/g, "/") : 'ipfs://' + path.join(mainData.cid.toV1().toString(), fullPath).replace(/\\/g, "/")
        return sendTheData(signal, { status: 200, headers: { 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Length': `${mainData.size}` }, body: '' })
      } catch (error) {
        if (error.message === `${main} does not exist`) {
          const useLink = 'ipfs://'  + path.join(fullHost, fullPath).replace(/\\/g, '/')
          return sendTheData(signal, { status: 400, headers: { 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'X-Error': error.message }, body: '' })
        } else {
          throw error
        }
      }
    }
  }

  async function handleGet(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

    const { mimeType: type, ext, fullHost, fullPath, isCID, slashHost, slashPath } = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))
    const useOpts = { timeout: reqHeaders.has('x-timer') || searchParams.has('x-timer') ? reqHeaders.get('x-timer') !== '0' || searchParams.get('x-timer') !== '0' ? Number(reqHeaders.get('x-timer') || searchParams.get('x-timer')) * 1000 : undefined : ipfsTimeout }

    const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

    try {
    const mainData = await app.files.stat(makeQuery(isCID, fullHost, slashHost, slashPath), useOpts)
    if (mainData.type === 'file') {
      const useLink = 'ipfs://' + path.join(mainData.cid.toV1().toString(), fullPath).replace(/\\/g, "/")
      const isRanged = reqHeaders.has('Range') || reqHeaders.has('range')
      if (isRanged) {
        const ranges = parseRange(mainData.size, reqHeaders.get('Range') || reqHeaders.get('range'))
        if (ranges && ranges.length && ranges.type === 'bytes') {
          const [{ start, end }] = ranges
          const length = (end - start + 1)
          return sendTheData(signal, {status: 206, headers: {'X-Link': `${useLink}`, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${length}`, 'Content-Range': `bytes ${start}-${end}/${mainData.size}`}, body: app.files.read(makeQuery(isCID, fullHost, slashHost, slashPath), { ...useOpts, offset: start, length })})
        } else {
          return sendTheData(signal, {status: 416, headers: {'X-Link': `${useLink}`, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Type': mainRes, 'Content-Length': `${mainData.size}`}, body: mainReq ? '<html><head><title>range</title></head><body><div><p>malformed or unsatisfiable range</p></div></body></html>' : JSON.stringify('malformed or unsatisfiable range')})
        }
      } else {
        return sendTheData(signal, {status: 200, headers: {'X-Link': `${useLink}`, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Type': type ? type.startsWith('text/') ? `${type}; charset=utf-8` : type : 'text/plain; charset=utf-8', 'Content-Length': `${mainData.size}`}, body: app.files.read(makeQuery(isCID, fullHost, slashHost, slashPath), { ...useOpts })})
      }
    } else if (mainData.type === 'directory') {
      const plain = await dirIter(app.files.ls(makeQuery(isCID, fullHost, slashHost, slashPath), useOpts))
      const useLink = 'ipfs://' + path.join(mainData.cid.toV1().toString(), '/').replace(/\\/g, "/")
      return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, body: mainReq ? `<html><head><title>${fullHost}</title></head><body><div>${JSON.stringify(plain.map((data) => {return `<p><a href="${data.link}">${data.name}</a></p>`}))}</div></body></html>` : JSON.stringify(plain)})
    } else {
      throw new Error('data is invalid')
    }
    } catch (error) {
        if (error.message === `${main} does not exist`) {
          const useLink = 'ipfs://' + path.join(fullHost, fullPath).replace(/\\/g, '/')
          return sendTheData(signal, { status: 400, headers: { 'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'X-Error': error.message }, body: mainReq ? `<html><head><title>${error.name}</title></head><body><div><p>${error.stack}</p></div></body></html>` : JSON.stringify(error.stack) })
        } else {
          throw error
        }
    }
  }

  async function handlePost(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {mimeType: type, ext, fullHost, fullPath, slashHost, slashPath, isCID} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))

      const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
      const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

    try {
      const useOpt = reqHeaders.has('x-opt') || searchParams.has('x-opt') ? JSON.parse(reqHeaders.get('x-opt') || decodeURIComponent(searchParams.get('x-opt'))) : {}
      const getSaved = reqHeaders.has('content-type') && reqHeaders.get('content-type').includes('multipart/form-data') ? await saveFormData(slashHost, slashPath, handleFormData(await request.formData()), { ...useOpt, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false }) : await saveFileData(slashHost, slashPath, body, { ...useOpt, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false })
      const saved = 'ipfs://' + path.join(fullHost, getSaved).replace(/\\/g, '/')
      const useLink = 'ipfs://' + path.join(fullHost, fullPath).replace(/\\/g, '/')
      return sendTheData(signal, {status: 200, headers: {'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`}, body: mainReq ? `<html><head><title>${fullHost}</title></head><body><div>${JSON.stringify(saved)}</div></body></html>` : JSON.stringify(saved)})
    } catch (error) {
      if (error.message === 'not a file') {
        const useLink = 'ipfs://' + path.join(fullHost, fullPath).replace(/\\/g, '/')
        return sendTheData(signal, { status: 400, headers: { 'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'X-Error': error.message }, body: mainReq ? `<html><head><title>${error.name}</title></head><body><div><p>${error.stack}</p></div></body></html>` : JSON.stringify(error.stack) })
      } else {
        throw error
      }
    }
  }

  async function handleDelete(request) {
    const { url, headers: reqHeaders, method, body, signal } = request

    if(signal){
      signal.addEventListener('abort', takeCareOfIt)
    }

      const { hostname, pathname, protocol, search, searchParams } = new URL(url)

      const {mimeType: type, ext, fullHost, fullPath, isCID, slashHost, slashPath} = formatReq(decodeURIComponent(hostname), decodeURIComponent(pathname))

    const mainReq = !reqHeaders.has('accept') || !reqHeaders.get('accept').includes('application/json')
    const mainRes = mainReq ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8'

    try {
    await app.files.rm(path.join(slashHost, slashPath).replace(/\\/g, '/'), { cidVersion: 1, recursive: true })
    const useLink = 'ipfs://' + path.join(fullHost, fullPath).replace(/\\/g, '/')
    return sendTheData(signal, { status: 200, headers: { 'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"` }, body: mainReq ? `<html><head><title>${fullHost}</title></head><body><div>${JSON.stringify(useLink)}</div></body></html>` : JSON.stringify(useLink) })
    } catch (error) {
      if (error.message === 'file does not exist') {
        const useLink = 'ipfs://' + path.join(fullHost, fullPath).replace(/\\/g, '/')
        return sendTheData(signal, { status: 400, headers: { 'Content-Type': mainRes, 'X-Link': useLink, 'Link': `<${useLink}>; rel="canonical"`, 'X-Error': error.message }, body: mainReq ? `<html><head><title>${error.name}</title></head><body><div><p>${error.stack}</p></div></body></html>` : JSON.stringify(error.stack) })
      } else {
        throw error
      }
    }
  }

  router.head('ipfs://*/**', handleHead)
  router.get('ipfs://*/**', handleGet)
  router.post('ipfs://*/**', handlePost)
  router.delete('ipfs://*/**', handleDelete)

  fetch.close = async () => {return await app.stop()}

  return fetch
}