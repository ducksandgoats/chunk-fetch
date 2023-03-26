# chunk-fetch

example of how a url looks like using chunk-fetch
`ipfs://someCidAsHostname/some/path`

`_` - hostname is ignored, url will start with the path and the path becomes the query, so ipfs://\_/somepath becomes ipfs://somepath
`CID` - a CID that is used for the query

method: `HEAD` - does not return a body, only returns headers<br>
hostname:

- `_` - ignores the hostname, path becomes the query<br>
  path:
  - `/path/to/dir/or/file` - it can be any path including `/`, this path is the query that will be used with ipfs
    headers:
    - `X-Copy` - `true` | `false` - if true, a directory will be created with the CID, the data will be stored inside that directory. if false, the data will be stored using the path but without the new directory.<br>
    - `X-Timer` - `String` - a number for a timeout<br>
- `CID` - a CID identifier for some data
  path:
  - `/` - used for a directory,if the `CID` is a directory<br>
    headers:
    - `X-Copy` - `true` | `false` - if true, a directory will be created with the CID, the data will be stored inside that directory. if false, the data will be stored using the path but without the new directory.<br>
    - `X-Timer` - `String` - a number for a timeout<br>
  - `/path/to/file` - used for a file, if the `CID` is a file
    headers:
    - `X-Copy` - `true` | `false` - if true, a directory will be created with the CID, the data will be stored inside that directory. if false, the data will be stored using the path but without the new directory.<br>
    - `X-Timer` - `String` - a number for a timeout<br>

method: `GET` - return a body<br>
hostname:

- `_` - ignores the hostname, path becomes the query<br>
  path:
  - `/path/to/dir/or/file` - it can be any path including `/`, this path is the query that will be used with ipfs<br>
    headers:
    - `X-Timer` - `String` - a number for a timeout<br>
- `CID` - a CID identifier for some data
  path:
  - `/` - used for a directory if the `CID` is a directory<br>
    headers:
    - `X-Timer` - `String` - a number for a timeout<br>
  - `/path/to/file` - used for a file, if the `CID` is a file
    headers:
    - `X-Timer` - `String` - a number for a timeout<br>

method: `POST` - return a body<br>
hostname:

- `_` - ignores the hostname, path becomes the query<br>
  path:
  - `/path/to/dir/or/file` - it can be any path including `/`, this path is the query that will be used with ipfs<br>
    headers:
    - `X-Opt` - `String` - options to use for the content, stringified object<br>

method: `DELETE` - returns a body<br>
hostname:

- `_` - ignores the hostname, path becomes the query<br>
  path:
  - `/path/to/dir/or/file` - it can be any path including `/`, this path is the query that will be used with ipfs<br>
    headers:
    - `X-Opt` - `String` - options to use for the content, stringified object<br>
