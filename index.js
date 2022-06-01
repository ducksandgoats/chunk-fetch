const makeFetch = require('make-fetch')
const parseRange = require('range-parser')
const mime = require('mime/lite')
const { CID } = require('multiformats/cid')
const Busboy = require('busboy')
const { Readable } = require('stream')
const IPFS = require('ipfs')
const path = require('path')

module.exports = async function makeIPFSFetch (opts = {}) {
  const DEFAULT_OPTS = {}
  const finalOpts = { ...DEFAULT_OPTS, ...opts }
  const app = await (async (finalOpts) => {if(finalOpts.ipfs){return finalOpts.ipfs}else{return await IPFS.create(finalOpts)}})(finalOpts)
  const ipfsTimeout = 30000
  const SUPPORTED_METHODS = ['GET', 'HEAD', 'PUT', 'DELETE']
  const encodeType = 'hex'
  const hostType = '_'

  function formatReq(hostname, pathname){
    let query = null
    let mimeType = null
    if(hostname === hostType){
      query = pathname
      mimeType = mime.getType(pathname)
    } else {
      if(hostname.includes('.')){
        try {
          hostname = hostname.split('.')
          query = CID.parse(hostname[0])
          mimeType = mime.getType(hostname[1])
        } catch (error) {
          throw error
        }
      } else {
        try {
          query = CID.parse(hostname)
          mimeType = mime.getType(pathname)
        } catch (err) {
          console.error(err.message)
          query = '/' + hostname
          const mid = pathname.split('/').filter(Boolean).map(data => {return decodeURIComponent(data)})
          if(mid.length){
            if(mid[mid.length - 1].includes('.')){
              query = query + '/' + mid.join('/')
            } else {
              query = query + '/' + mid.join('/') + '/'
            }
          }
          mimeType = mime.getType(pathname)
        }
      }
    }
    return {query, mimeType}
  }

  function getMime (path) {
    let mimeType = mime.getType(path)
    if (mimeType && mimeType.startsWith('text/')) mimeType = `${mimeType}; charset=utf-8`
    return mimeType
  }

  function getType (type) {
    if (type.startsWith('text/')) type = `${type}; charset=utf-8`
    return type
  }

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
      item.link = 'ipfs://' + item.cid
      result.push(item)
    }
    return result
  }

  async function saveFormData (path, content, useHeaders, useOpts) {
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
        const usePath = path + info.filename
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
        useData.cid = useData.cid.toV1().toString()
        useData.link = 'ipfs://' + useData.cid
        useData.file = i
        result.push(useData)
      } catch (error) {
        console.error(typeof(error))
        const useData = {}
        useData.file = i
        result.push(useData)
      }
    }
    return result
  }

  async function iterFile(data, opts){
    const result = []
    try {
      const useData = await app.files.stat(data, opts)
      useData.cid = useData.cid.toV1().toString()
      useData.link = 'ipfs://' + useData.cid
      useData.file = i
      result.push(useData)
    } catch (error) {
      console.error(typeof(error))
      const useData = {}
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
      const { hostname, pathname, protocol, searchParams } = new URL(url)
      const mainHostname = hostname && hostname.startsWith(encodeType) ? Buffer.from(hostname.slice(encodeType.length), 'hex').toString('utf-8') : hostname

      if (protocol !== 'ipfs:') {
        return { statusCode: 409, headers: {}, data: ['wrong protocol'] }
      } else if (!method || !SUPPORTED_METHODS.includes(method)) {
        return { statusCode: 409, headers: {}, data: ['something wrong with method'] }
      } else if ((!mainHostname) || ((mainHostname.length === 1) && (pathname.split('/').filter(Boolean).length > 1 || mainHostname !== hostType))) {
        return { statusCode: 409, headers: {}, data: ['something wrong with hostname'] }
      }

      const {query: main, mimeType: type} = formatReq(mainHostname, pathname)

      if(method === 'HEAD'){
        let mainData = null
        try {
          mainData = await app.files.stat(main, {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout})
        } catch (error) {
          return {statusCode: 400, headers: {'X-Issue': error.message}, data: []}
        }
        return {statusCode: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, data: []}
      } else if(method === 'GET'){
        let mainData = null
        try {
          mainData = await app.files.stat(main, {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout})
        } catch (error) {
          if(!reqHeaders['accept'] || !reqHeaders['accept'].includes('text/html') || !reqHeaders['accept'].includes('application/json')){
            return {statusCode: 400, headers: {'Content-Type': 'text/plain; charset=utf-8', 'X-Issue': error.name}, data: [error.stack]}
          } else if(reqHeaders['accept'].includes('text/html')){
            return {statusCode: 400, headers: {'Content-Type': 'text/html; charset=utf-8', 'X-Issue': error.name}, data: [`<html><head><title>Fetch</title></head><body><div>${error.stack}</div></body></html>`]}
          } else if(reqHeaders['accept'].includes('application/json')){
            return {statusCode: 400, headers: {'Content-Type': 'application/json; charset=utf-8', 'X-Issue': error.name}, data: [JSON.stringify(error.stack)]}
          }
        }
        if(mainData.type === 'directory'){
          if(!reqHeaders['accept'] || !reqHeaders['accept'].includes('text/html') || !reqHeaders['accept'].includes('application/json')){
            const plain = await dirIter(app.files.ls(main, {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout}))
            let useData = ''
            plain.forEach(data => {
              for(const prop in data){
                useData += `${prop}: ${data[prop]}\n`
              }
              useData += '\n\n\n'
            })
            return {statusCode: 200, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, data: [useData]}
          } else if(reqHeaders['accept'].includes('text/html')){
            const plain = await dirIter(app.files.ls(main, {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout}))
            return {statusCode: 200, headers: {'Content-Type': 'text/html; charset=utf-8', 'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, data: [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(plain)}</div></body></html>`]}
          } else if(reqHeaders['accept'].includes('application/json')){
            const plain = await dirIter(app.files.ls(main, {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout}))
            return {statusCode: 200, headers: {'Content-Type': 'application/json; charset=utf-8', 'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Length': `${mainData.size}`}, data: [JSON.stringify(plain)]}
          }
        } else if(mainData.type === 'file'){
          if(reqHeaders.Range || reqHeaders.range){
            const ranges = parseRange(size, isRanged)
            if (ranges && ranges.length && ranges.type === 'bytes') {
              const [{ start, end }] = ranges
              const length = (end - start + 1)
              return {statusCode: 206, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Type': type ? getType(type) : 'CID', 'Content-Length': `${length}`, 'Content-Range': `bytes ${start}-${end}/${mainData.size}`}, data: app.files.read(main, { offset: start, length, timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout })}
            } else {
              return {statusCode: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Type': type ? getType(type) : 'CID', 'Content-Length': `${mainData.size}`}, data: app.files.read(main, { timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout })}
            }
          } else {
            return {statusCode: 200, headers: {'Link': `<ipfs://${mainData.cid.toV1().toString()}>; rel="canonical"`, 'Content-Type': type ? getType(type) : 'CID', 'Content-Length': `${mainData.size}`}, data: app.files.read(main, { timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout })}
          }
        } else {
          throw new Error('not a directory or file')
        }
      } else if(method === 'PUT'){
        let mainData = null
        try {
          if(reqHeaders['content-type'] && reqHeaders['content-type'].includes('multipart/form-data')){
            mainData = await saveFormData(main, body, reqHeaders, reqHeaders['x-opt'] ? {...JSON.parse(reqHeaders['x-opt']), ...{timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false}} : {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false})
            mainData = await iterFiles(mainData, {timeout: ipfsTimeout})
          } else {
            await app.files.write(main, body, reqHeaders['x-opt'] ? {...JSON.parse(reqHeaders['x-opt']), ...{timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false}} : {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout, cidVersion: 1, parents: true, truncate: true, create: true, rawLeaves: false})
            mainData = await iterFile(main, {timeout: ipfsTimeout})
          }
        } catch (error) {
          if(!reqHeaders['accept'] || !reqHeaders['accept'].includes('text/html') || !reqHeaders['accept'].includes('application/json')){
            return {statusCode: 400, headers: {'Content-Type': 'text/plain; charset=utf-8', 'X-Issue': error.name}, data: [error.message]}
          } else if(reqHeaders['accept'].includes('text/html')){
            return {statusCode: 400, headers: {'Content-Type': 'text/html; charset=utf-8', 'X-Issue': error.name}, data: [`<html><head><title>Fetch</title></head><body><div>${error.message}</div></body></html>`]}
          } else if(reqHeaders['accept'].includes('application/json')){
            return {statusCode: 400, headers: {'Content-Type': 'application/json; charset=utf-8', 'X-Issue': error.name}, data: [JSON.stringify(error.message)]}
          }
        }
        if((!reqHeaders['accept']) || (!reqHeaders['accept'].includes('text/html') && !reqHeaders['accept'].includes('application/json'))){
          let useData = ''
          mainData.forEach(data => {
            for(const prop in data){
              useData += `${prop}: ${data[prop]}\n`
            }
            useData += '\n\n\n'
          })
          return {statusCode: 200, headers: {'Content-Type': 'text/plain; charset=utf-8'}, data: [useData]}
        } else if(reqHeaders['accept'].includes('text/html')){
          return {statusCode: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}, data: [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>`]}
        } else if(reqHeaders['accept'].includes('application/json')){
          return {statusCode: 200, headers: {'Content-Type': 'application/json; charset=utf-8'}, data: [JSON.stringify(mainData)]}
        }
      } else if(method === 'DELETE'){
        let mainData = null
        try {
          mainData = await app.files.stat(main, {timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout})
          mainData.cid = mainData.cid.toV1().toString()
          mainData.link = 'ipfs://' + mainData.cid
        } catch (error) {
          if(!reqHeaders['accept'] || !reqHeaders['accept'].includes('text/html') || !reqHeaders['accept'].includes('application/json')){
            return {statusCode: 400, headers: {'Content-Type': 'text/plain; charset=utf-8', 'X-Issue': error.name}, data: [error.message]}
          } else if(reqHeaders['accept'].includes('text/html')){
            return {statusCode: 400, headers: {'Content-Type': 'text/html; charset=utf-8', 'X-Issue': error.name}, data: [`<html><head><title>Fetch</title></head><body><div>${error.message}</div></body></html>`]}
          } else if(reqHeaders['accept'].includes('application/json')){
            return {statusCode: 400, headers: {'Content-Type': 'application/json; charset=utf-8', 'X-Issue': error.name}, data: [JSON.stringify(error.message)]}
          }
        }
        if(mainData.type === 'directory'){
          await app.files.rm(main, {cidVersion: 1, recursive: true, timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout})
        } else if(mainData.type === 'file'){
          await app.files.rm(main, {cidVersion: 1, timeout: reqHeaders['x-timer'] && reqHeaders['x-timer'] !== '0' ? Number(reqHeaders['x-timer']) * 1000 : ipfsTimeout})
        } else {
          throw new Error('not a directory or file')
        }
        if(!reqHeaders['accept'] || !reqHeaders['accept'].includes('text/html') || !reqHeaders['accept'].includes('application/json')){
          let useData = ''
          for(const prop in mainData){
            useData += `${prop}: ${mainData[prop]}\n`
          }
          return {statusCode: 200, headers: {'Content-Type': 'text/plain; charset=utf-8'}, data: [useData]}
        } else if(reqHeaders['accept'].includes('text/html')){
          return {statusCode: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}, data: [`<html><head><title>Fetch</title></head><body><div>${JSON.stringify(mainData)}</div></body></html>`]}
        } else if(reqHeaders['accept'].includes('application/json')){
          return {statusCode: 200, headers: {'Content-Type': 'application/json; charset=utf-8'}, data: [JSON.stringify(mainData)]}
        }
      } else {
        return {statusCode: 400, headers: {}, data: ['wrong method']}
      }
    } catch (error) {
      if(!reqHeaders['accept'] || !reqHeaders['accept'].includes('text/html') || !reqHeaders['accept'].includes('application/json')){
        return {statusCode: 500, headers: {'Content-Type': 'text/plain; charset=utf-8'}, data: [error.stack]}
      } else if(reqHeaders['accept'].includes('text/html')){
        return {statusCode: 500, headers: {'Content-Type': 'text/html; charset=utf-8'}, data: [`<html><head><title>${error.name}</title></head><body><div><p>${error.stack}</p></div></body></html>`]}
      } else if(reqHeaders['accept'].includes('application/json')){
        return {statusCode: 500, headers: {'Content-Type': 'application/json; charset=utf-8'}, data: [JSON.stringify(error.stack)]}
      }
    }
  })

  fetch.close = async () => {return await app.stop()}

  return fetch
}