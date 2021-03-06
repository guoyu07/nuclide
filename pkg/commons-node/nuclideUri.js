'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

// NuclideUri's are either a local file path, or a URI
// of the form nuclide://<host><path>
//
// This package creates, queries and decomposes NuclideUris.

export type NuclideUri = string;

type ParsedUrl = {
  auth: ?string,
  href: string,
  host: ?string,
  hostname: ?string,
  path: string,
  pathname: string,
  protocol: ?string,
  query: ?any,
  search: ?string,
  slashes: ?boolean,
};

type ParsedRemoteUrl = {
  auth: ?string,
  href: string,
  host: ?string,
  hostname: string,
  path: string,
  pathname: string,
  protocol: ?string,
  query: ?any,
  search: ?string,
  slashes: ?boolean,
};

type ParsedPath = {
  root: string,
  dir: string,
  base: string,
  ext: string,
  name: string,
};

import invariant from 'assert';
// eslint-disable-next-line nuclide-internal/prefer-nuclide-uri
import pathModule from 'path';

import url from 'url';

import {maybeToString} from './string';

const REMOTE_PATH_URI_PREFIX = 'nuclide://';
const URI_PREFIX_REGEX = /^[A-Za-z0-9_-]+:\/\/.*/;

function isRemote(uri: NuclideUri): boolean {
  return uri.startsWith(REMOTE_PATH_URI_PREFIX);
}

// When restoring Atom state on load, Atom mangles our remote URIs by
// removing one of the '/'s. These TextBuffers/TextEditors live for a short time
// and are destroyed during Nuclide startup.
function isBrokenDeserializedUri(uri: ?NuclideUri): boolean {
  return uri != null && uri.match(/nuclide:[\\/][^/]/) != null;
}

function isUri(uri: string): boolean {
  return URI_PREFIX_REGEX.test(uri);
}

function isLocal(uri: NuclideUri): boolean {
  return !isRemote(uri) && !isUri(uri);
}

function createRemoteUri(hostname: string, remotePath: string): string {
  invariant(remotePath != null && remotePath !== '', 'NuclideUri must include a path.');
  return `nuclide://${hostname}${remotePath}`;
}

/**
 * Parses `uri` with Node's `url.parse` and calls `decodeURI` on `href`, `path`, and `pathname` of
 * the parsed URL object.
 *
 * * `url.parse` seems to apply encodeURI to the URL, and we typically don't want this behavior.
 * * Nuclide URIs disallow use of the `hash` attribute, and any hash characters are interpreted as
 *   as literal hashes.
 *
 *   For example:
 *
 *       parse('nuclide://f.co/path/to/#foo.txt#')
 *       >
 *         {
 *           ...
 *           path: '/path/to/#foo.txt#',
 *           ...
 *         }
 */
function parse(uri: NuclideUri): ParsedUrl {
  const parsedUri = url.parse(_escapeSpecialCharacters(uri));
  if (parsedUri.protocol == null) {
    return {
      auth: null,
      host: null,
      hostname: null,
      href: uri,
      path: uri,
      pathname: uri,
      protocol: null,
      query: null,
      search: null,
      slashes: null,
    };
  }

  invariant(
    parsedUri.path,
    'Nuclide URIs must contain paths, ' +
    `${maybeToString(parsedUri.path)}' found while parsing '${uri}'`,
  );

  let path = parsedUri.path;
  // `url.parse` treates the first '#' character as the beginning of the `hash` attribute. That
  // feature is not used in Nuclide and is instead treated as part of the path.
  if (parsedUri.hash != null) {
    path += parsedUri.hash;
  }

  invariant(
    parsedUri.pathname,
    'Nuclide URIs must contain pathnamess, ' +
    `'${maybeToString(parsedUri.pathname)}' found while parsing '${uri}'`,
  );
  let pathname = parsedUri.pathname;
  // `url.parse` treates the first '#' character as the beginning of the `hash` attribute. That
  // feature is not used in Nuclide and is instead treated as part of the pathname.
  if (parsedUri.hash != null) {
    pathname += parsedUri.hash;
  }

  // Explicitly copying object properties appeases Flow's "maybe" type handling. Using the `...`
  // operator causes null/undefined errors, and `Object.assign` bypasses type checking.
  return {
    auth: parsedUri.auth,
    host: parsedUri.host,
    hostname: parsedUri.hostname,
    href: decodeURI(parsedUri.href),
    path: decodeURI(path),
    pathname: decodeURI(pathname),
    protocol: parsedUri.protocol,
    query: parsedUri.query,
    search: parsedUri.search,
    slashes: parsedUri.slashes,
  };
}

function parseRemoteUri(remoteUri: NuclideUri): ParsedRemoteUrl {
  if (!isRemote(remoteUri)) {
    throw new Error('Expected remote uri. Got ' + remoteUri);
  }
  const parsedUri = parse(remoteUri);
  invariant(
    parsedUri.hostname,
    `Remote Nuclide URIs must contain hostnames, '${maybeToString(parsedUri.hostname)}' found ` +
    `while parsing '${remoteUri}'`,
  );

  // Explicitly copying object properties appeases Flow's "maybe" type handling. Using the `...`
  // operator causes null/undefined errors, and `Object.assign` bypasses type checking.
  return {
    auth: parsedUri.auth,
    host: parsedUri.host,
    hostname: parsedUri.hostname,
    href: parsedUri.href,
    path: parsedUri.path,
    pathname: parsedUri.pathname,
    protocol: parsedUri.protocol,
    query: parsedUri.query,
    search: parsedUri.search,
    slashes: parsedUri.slashes,
  };
}

function getPath(uri: NuclideUri): string {
  return parse(uri).path;
}

function getHostname(remoteUri: NuclideUri): string {
  return parseRemoteUri(remoteUri).hostname;
}

function getHostnameOpt(remoteUri: ?NuclideUri): ?string {
  if (remoteUri == null || !isRemote(remoteUri)) {
    return null;
  }

  return getHostname(remoteUri);
}

function join(uri: NuclideUri, ...relativePath: Array<string>): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);
  if (isRemote(uri)) {
    const {hostname, path} = parseRemoteUri(uri);
    relativePath.splice(0, 0, path);
    return createRemoteUri(
      hostname,
      uriPathModule.join.apply(null, relativePath));
  } else {
    relativePath.splice(0, 0, uri);
    return uriPathModule.join.apply(null, relativePath);
  }
}

function normalize(uri: NuclideUri): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);
  if (isRemote(uri)) {
    const {hostname, path} = parseRemoteUri(uri);
    return createRemoteUri(
      hostname,
      uriPathModule.normalize(path),
    );
  } else {
    return uriPathModule.normalize(uri);
  }
}

function normalizeDir(uri: NuclideUri): NuclideUri {
  return ensureTrailingSeparator(normalize(uri));
}

function getParent(uri: NuclideUri): NuclideUri {
  // TODO: Is this different than dirname?
  return normalize(join(uri, '..'));
}

function relative(uri: NuclideUri, other: NuclideUri): string {
  const uriPathModule = _pathModuleFor(uri);
  const remote = isRemote(uri);
  if (remote !== isRemote(other) ||
      (remote && getHostname(uri) !== getHostname(other))) {
    throw new Error(`Cannot relative urls on different hosts: ${uri} and ${other}`);
  }
  if (remote) {
    return uriPathModule.relative(getPath(uri), getPath(other));
  } else {
    return uriPathModule.relative(uri, other);
  }
}

function basename(uri: NuclideUri, ext: string = ''): string {
  const uriPathModule = _pathModuleFor(uri);
  return uriPathModule.basename(getPath(uri), ext);
}

function dirname(uri: NuclideUri): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);
  if (isRemote(uri)) {
    const {hostname, path} = parseRemoteUri(uri);
    return createRemoteUri(
      hostname,
      uriPathModule.dirname(path),
    );
  } else {
    return uriPathModule.dirname(uri);
  }
}

function extname(uri: NuclideUri): string {
  const uriPathModule = _pathModuleFor(uri);
  return uriPathModule.extname(getPath(uri));
}

function stripExtension(uri: NuclideUri): NuclideUri {
  const ext = extname(uri);
  if (ext.length === 0) {
    return uri;
  }

  return uri.slice(0, -1 * ext.length);
}

/**
 * uri is either a file: uri, or a nuclide: uri.
 * must convert file: uri's to just a path for atom.
 *
 * Returns null if not a valid file: URI.
 */
function uriToNuclideUri(uri: string): ?string {
  const urlParts = url.parse(_escapeSpecialCharacters(uri), false);
  if (urlParts.protocol === 'file:' && urlParts.path) { // only handle real files for now.
    return urlParts.path;
  } else if (isRemote(uri)) {
    return uri;
  } else {
    return null;
  }
}

/**
 * Converts local paths to file: URI's. Leaves remote URI's alone.
 */
function nuclideUriToUri(uri: NuclideUri): string {
  if (isRemote(uri)) {
    return uri;
  } else {
    return 'file://' + uri;
  }
}

/**
 * Returns true if child is equal to, or is a proper child of parent.
 */
function contains(parent: NuclideUri, child: NuclideUri): boolean {
  // Can't just do startsWith here. If this directory is "www" and you
  // are trying to check "www-base", just using startsWith would return
  // true, even though "www-base" is at the same level as "Www", not
  // contained in it.
  // Also, there's an issue with a trailing separator ambiguity. A path
  // like /abc/ does contain /abc
  // This function is used in some performance-sensitive parts, so we
  // want to avoid doing unnecessary string copy, as those that would
  // result from an ensureTrailingSeparator() call
  //
  // First we'll check the lengths.
  // Then check startsWith. If so, then if the two path lengths are
  // equal OR if the next character in the path to check is a path
  // separator, then we know the checked path is in this path.

  if (child.length < parent.length) {  // A strong indication of false
    // It could be a matter of a trailing separator, though
    if (child.length < parent.length - 1) { // It must be more than just the separator
      return false;
    }

    return endsWithSeparator(parent) && parent.startsWith(child);
  }

  if (!child.startsWith(parent)) {
    return false;
  }

  if (endsWithSeparator(parent) || parent.length === child.length) {
    return true;
  }

  const uriPathModule = _pathModuleFor(child);
  return child.slice(parent.length).startsWith(uriPathModule.sep);
}

/**
 * Filter an array of paths to contain only the collapsed root paths, e.g.
 * [a/b/c, a/, c/d/, c/d/e] collapses to [a/, c/d/]
 */
function collapse(paths: Array<NuclideUri>): Array<NuclideUri> {
  return paths.filter(p =>
    !paths.some(fp => contains(fp, p) && fp !== p),
  );
}

const hostFormatters = [];

// A formatter which may shorten hostnames.
// Returns null if the formatter won't shorten the hostname.
export type HostnameFormatter = (uri: NuclideUri) => ?string;

// Registers a host formatter for nuclideUriToDisplayString
function registerHostnameFormatter(formatter: HostnameFormatter): IDisposable {
  hostFormatters.push(formatter);
  return {
    dispose: () => {
      const index = hostFormatters.indexOf(formatter);
      if (index >= 0) {
        hostFormatters.splice(index, 1);
      }
    },
  };
}

/**
 * NuclideUris should never be shown to humans.
 * This function returns a human usable string.
 */
function nuclideUriToDisplayString(uri: NuclideUri): string {
  if (isRemote(uri)) {
    let hostname = getHostname(uri);
    for (const formatter of hostFormatters) {
      const formattedHostname = formatter(hostname);
      if (formattedHostname) {
        hostname = formattedHostname;
        break;
      }
    }
    return `${hostname}/${getPath(uri)}`;
  } else {
    return uri;
  }
}

function ensureTrailingSeparator(uri: NuclideUri): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);
  if (uri.endsWith(uriPathModule.sep)) {
    return uri;
  }

  return uri + uriPathModule.sep;
}

function trimTrailingSeparator(uri: NuclideUri): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);
  let stripped = uri;

  while (stripped.endsWith(uriPathModule.sep) && !isRoot(stripped)) {
    stripped = stripped.slice(0, -1 * uriPathModule.sep.length);
  }

  return stripped;
}

function endsWithSeparator(uri: NuclideUri): boolean {
  const uriPathModule = _pathModuleFor(uri);
  return uri.endsWith(uriPathModule.sep);
}

function isAbsolute(uri: NuclideUri): boolean {
  if (isRemote(uri)) {
    return true;
  } else {
    const uriPathModule = _pathModuleFor(uri);
    return uriPathModule.isAbsolute(uri);
  }
}

function resolve(uri: NuclideUri, ...paths: Array<string>): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);
  if (isRemote(uri)) {
    const {hostname, path} = parseRemoteUri(uri);
    paths.splice(0, 0, path);
    return createRemoteUri(
      hostname,
      uriPathModule.resolve.apply(null, paths));
  } else {
    paths.splice(0, 0, uri);
    return uriPathModule.resolve.apply(null, paths);
  }
}

function expandHomeDir(uri: NuclideUri): NuclideUri {
  // This function is POSIX only functionality, so using the posix path directly

  // Do not expand non home relative uris
  if (!uri.startsWith('~')) {
    return uri;
  }

  const {HOME} = process.env;
  invariant(HOME != null);

  if (uri === '~') {
    return HOME;
  }

  // Uris like ~abc should not be expanded
  if (!uri.startsWith('~/')) {
    return uri;
  }

  return posixPath.resolve(HOME, uri.replace('~', '.'));
}

/**
 * Splits a string containing local paths by an OS-specific path delimiter
 * Useful for splitting env variables such as PATH
 *
 * Since remote URI might contain the delimiter, only local paths are allowed.
 */
function splitPathList(paths: string): Array<NuclideUri> {
  invariant(paths.indexOf(REMOTE_PATH_URI_PREFIX) < 0, 'Splitting remote URIs is not supported');
  const uriPathModule = _pathModuleFor(paths);

  return paths.split(uriPathModule.delimiter);
}

/**
 * Joins an array of local paths with an OS-specific path delimiter into a single string.
 * Useful for constructing env variables such as PATH
 *
 * Since remote URI might contain the delimiter, only local paths are allowed.
 */
function joinPathList(paths: Array<NuclideUri>): string {
  if (paths.length === 0) {
    return '';
  }

  invariant(paths.every(path => !isRemote(path)), 'Joining of remote URIs is not supported');

  const uriPathModule = _pathModuleFor(paths[0]);
  return paths.join(uriPathModule.delimiter);
}

/**
 * This function prepends the given relative path with a "current-folder" prefix
 * which is `./` on *nix and .\ on Windows
 */
function ensureLocalPrefix(uri: NuclideUri): NuclideUri {
  const uriPathModule = _pathModuleFor(uri);

  invariant(!isRemote(uri), 'Local prefix can not be added to a remote path');
  invariant(!isAbsolute(uri), 'Local prefix can not be added to an absolute path');

  const localPrefix = `.${uriPathModule.sep}`;
  if (uri.startsWith(localPrefix)) {
    return uri;
  }

  return localPrefix + uri;
}

function isRoot(uri: NuclideUri): boolean {
  return dirname(uri) === uri;
}

function parsePath(uri: NuclideUri): ParsedPath {
  const uriPathModule = _pathModuleFor(uri);
  return uriPathModule.parse(getPath(uri));
}

function split(uri: string): Array<string> {
  const parts = [];
  let current = uri;
  let parent = dirname(current);

  while (current !== parent) {
    parts.push(basename(current));

    current = parent;
    parent = dirname(current);
  }

  if (isAbsolute(uri)) {
    parts.push(parent);
  }
  parts.reverse();
  return parts;
}

/**
 * win32.isAbsolute is buggy in Node 5.10.0, but not in Node 5.1.1 or 6.0.0+.
 * As long as we support Node 5, we'll use the fixed version of win32.isAbsolute.
 * https://github.com/nodejs/node/commit/3072546feb9d7f78f12d75bec28ef00e5958f7be
 */

function _win32PathIsAbsolute(path: string): boolean {
  if (typeof path !== 'string') {
    throw new TypeError('Path must be a string. Received ' + String(path));
  }
  const len = path.length;
  if (len === 0) {
    return false;
  }
  let code = path.charCodeAt(0);
  if (code === 47 || code === 92) {
    return true;
  } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
    if (len > 2 && path.charCodeAt(1) === 58) {
      code = path.charCodeAt(2);
      if (code === 47 || code === 92) {
        return true;
      }
    }
  }
  return false;
}

const posixPath: typeof pathModule = {...pathModule.posix};
const win32Path: typeof pathModule = {...pathModule.win32, isAbsolute: _win32PathIsAbsolute};

function _pathModuleFor(uri: NuclideUri): typeof pathModule {
  if (uri.startsWith(posixPath.sep)) {
    return posixPath;
  }
  if (uri.indexOf('://') > -1) {
    return posixPath;
  }
  if (uri[1] === ':' && uri[2] === win32Path.sep) {
    return win32Path;
  }

  if (uri.split(win32Path.sep).length > uri.split(posixPath.sep).length) {
    return win32Path;
  } else {
    return posixPath;
  }
}

/**
 * The backslash and percent characters (\ %) are, unfortunately, valid symbols to be used in POSIX
 * paths. They, however, are being automatically "corrected" by node's `url.parse()` method if not
 * escaped properly.
 */
function _escapeSpecialCharacters(uri: NuclideUri): NuclideUri {
  return uri.replace(/%/g, '%25').replace(/\\/g, '%5C');
}

const NUCLIDE_URI_TYPE_NAME = 'NuclideUri';

// If mustBeRemote is present then remote-ness must match, otherwise remote-ness
// is ignored.
function validate(uri: NuclideUri, mustBeRemote?: boolean): void {
  // Be a little extra paranoid to catch places where the type system may be weak.
  invariant(uri != null, 'Unexpected null NuclideUri');
  invariant(typeof uri === 'string', `Unexpected NuclideUri type: ${String(uri)}`);

  if (isRemote(uri)) {
    parse(uri);
    invariant(mustBeRemote !== false, 'Expected remote NuclideUri');
  } else {
    invariant(uri !== '', 'NuclideUri must contain a non-empty path');
    invariant(mustBeRemote !== true, 'Expected local NuclideUri');
  }
}

export default {
  basename,
  dirname,
  extname,
  stripExtension,
  isRemote,
  isBrokenDeserializedUri,
  isLocal,
  createRemoteUri,
  parse,
  parseRemoteUri,
  validate,
  getPath,
  getHostname,
  getHostnameOpt,
  join,
  relative,
  normalize,
  normalizeDir,
  getParent,
  uriToNuclideUri,
  nuclideUriToUri,
  contains,
  collapse,
  nuclideUriToDisplayString,
  registerHostnameFormatter,
  ensureTrailingSeparator,
  trimTrailingSeparator,
  endsWithSeparator,
  isAbsolute,
  resolve,
  expandHomeDir,
  splitPathList,
  joinPathList,
  ensureLocalPrefix,
  isRoot,
  parsePath,
  split,
  NUCLIDE_URI_TYPE_NAME,
};

export const __TEST__ = {
  _pathModuleFor,
  _win32PathIsAbsolute,
};
