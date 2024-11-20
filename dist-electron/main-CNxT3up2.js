var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { ipcMain, dialog, app, BrowserWindow, nativeTheme } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path$1, { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import require$$1 from "tty";
import require$$1$1 from "util";
import require$$0$1 from "os";
import { inspect } from "node:util";
import require$$0$5 from "node:os";
import require$$0$4 from "node:events";
import require$$0$2 from "fs";
import require$$1$2 from "events";
import require$$3 from "path";
import require$$5 from "assert";
import require$$2 from "worker_threads";
import require$$0$3 from "module";
import require$$4 from "url";
import require$$7 from "buffer";
const defaultMessages = "End-Of-Stream";
class EndOfStreamError extends Error {
  constructor() {
    super(defaultMessages);
  }
}
class AbstractStreamReader {
  constructor() {
    this.maxStreamReadSize = 1 * 1024 * 1024;
    this.endOfStream = false;
    this.peekQueue = [];
  }
  async peek(uint8Array, offset, length) {
    const bytesRead = await this.read(uint8Array, offset, length);
    this.peekQueue.push(uint8Array.subarray(offset, offset + bytesRead));
    return bytesRead;
  }
  async read(buffer, offset, length) {
    if (length === 0) {
      return 0;
    }
    let bytesRead = this.readFromPeekBuffer(buffer, offset, length);
    bytesRead += await this.readRemainderFromStream(buffer, offset + bytesRead, length - bytesRead);
    if (bytesRead === 0) {
      throw new EndOfStreamError();
    }
    return bytesRead;
  }
  /**
   * Read chunk from stream
   * @param buffer - Target Uint8Array (or Buffer) to store data read from stream in
   * @param offset - Offset target
   * @param length - Number of bytes to read
   * @returns Number of bytes read
   */
  readFromPeekBuffer(buffer, offset, length) {
    let remaining = length;
    let bytesRead = 0;
    while (this.peekQueue.length > 0 && remaining > 0) {
      const peekData = this.peekQueue.pop();
      if (!peekData)
        throw new Error("peekData should be defined");
      const lenCopy = Math.min(peekData.length, remaining);
      buffer.set(peekData.subarray(0, lenCopy), offset + bytesRead);
      bytesRead += lenCopy;
      remaining -= lenCopy;
      if (lenCopy < peekData.length) {
        this.peekQueue.push(peekData.subarray(lenCopy));
      }
    }
    return bytesRead;
  }
  async readRemainderFromStream(buffer, offset, initialRemaining) {
    let remaining = initialRemaining;
    let bytesRead = 0;
    while (remaining > 0 && !this.endOfStream) {
      const reqLen = Math.min(remaining, this.maxStreamReadSize);
      const chunkLen = await this.readFromStream(buffer, offset + bytesRead, reqLen);
      if (chunkLen === 0)
        break;
      bytesRead += chunkLen;
      remaining -= chunkLen;
    }
    return bytesRead;
  }
}
class WebStreamReader extends AbstractStreamReader {
  constructor(stream) {
    super();
    this.reader = stream.getReader({ mode: "byob" });
  }
  async readFromStream(buffer, offset, length) {
    if (this.endOfStream) {
      throw new EndOfStreamError();
    }
    const result = await this.reader.read(new Uint8Array(length));
    if (result.done) {
      this.endOfStream = result.done;
    }
    if (result.value) {
      buffer.set(result.value, offset);
      return result.value.byteLength;
    }
    return 0;
  }
  async abort() {
    await this.reader.cancel();
    this.reader.releaseLock();
  }
}
class AbstractTokenizer {
  /**
   * Constructor
   * @param options Tokenizer options
   * @protected
   */
  constructor(options) {
    this.position = 0;
    this.numBuffer = new Uint8Array(8);
    this.fileInfo = (options == null ? void 0 : options.fileInfo) ?? {};
    this.onClose = options == null ? void 0 : options.onClose;
    if (options == null ? void 0 : options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        this.abort();
      });
    }
  }
  /**
   * Read a token from the tokenizer-stream
   * @param token - The token to read
   * @param position - If provided, the desired position in the tokenizer-stream
   * @returns Promise with token data
   */
  async readToken(token, position = this.position) {
    const uint8Array = new Uint8Array(token.len);
    const len = await this.readBuffer(uint8Array, { position });
    if (len < token.len)
      throw new EndOfStreamError();
    return token.get(uint8Array, 0);
  }
  /**
   * Peek a token from the tokenizer-stream.
   * @param token - Token to peek from the tokenizer-stream.
   * @param position - Offset where to begin reading within the file. If position is null, data will be read from the current file position.
   * @returns Promise with token data
   */
  async peekToken(token, position = this.position) {
    const uint8Array = new Uint8Array(token.len);
    const len = await this.peekBuffer(uint8Array, { position });
    if (len < token.len)
      throw new EndOfStreamError();
    return token.get(uint8Array, 0);
  }
  /**
   * Read a numeric token from the stream
   * @param token - Numeric token
   * @returns Promise with number
   */
  async readNumber(token) {
    const len = await this.readBuffer(this.numBuffer, { length: token.len });
    if (len < token.len)
      throw new EndOfStreamError();
    return token.get(this.numBuffer, 0);
  }
  /**
   * Read a numeric token from the stream
   * @param token - Numeric token
   * @returns Promise with number
   */
  async peekNumber(token) {
    const len = await this.peekBuffer(this.numBuffer, { length: token.len });
    if (len < token.len)
      throw new EndOfStreamError();
    return token.get(this.numBuffer, 0);
  }
  /**
   * Ignore number of bytes, advances the pointer in under tokenizer-stream.
   * @param length - Number of bytes to ignore
   * @return resolves the number of bytes ignored, equals length if this available, otherwise the number of bytes available
   */
  async ignore(length) {
    if (this.fileInfo.size !== void 0) {
      const bytesLeft = this.fileInfo.size - this.position;
      if (length > bytesLeft) {
        this.position += bytesLeft;
        return bytesLeft;
      }
    }
    this.position += length;
    return length;
  }
  async close() {
    var _a;
    await this.abort();
    await ((_a = this.onClose) == null ? void 0 : _a.call(this));
  }
  normalizeOptions(uint8Array, options) {
    if (options && options.position !== void 0 && options.position < this.position) {
      throw new Error("`options.position` must be equal or greater than `tokenizer.position`");
    }
    if (options) {
      return {
        mayBeLess: options.mayBeLess === true,
        offset: options.offset ? options.offset : 0,
        length: options.length ? options.length : uint8Array.length - (options.offset ? options.offset : 0),
        position: options.position ? options.position : this.position
      };
    }
    return {
      mayBeLess: false,
      offset: 0,
      length: uint8Array.length,
      position: this.position
    };
  }
  abort() {
    return Promise.resolve();
  }
}
const maxBufferSize = 256e3;
class ReadStreamTokenizer extends AbstractTokenizer {
  /**
   * Constructor
   * @param streamReader stream-reader to read from
   * @param options Tokenizer options
   */
  constructor(streamReader, options) {
    super(options);
    this.streamReader = streamReader;
  }
  /**
   * Read buffer from tokenizer
   * @param uint8Array - Target Uint8Array to fill with data read from the tokenizer-stream
   * @param options - Read behaviour options
   * @returns Promise with number of bytes read
   */
  async readBuffer(uint8Array, options) {
    const normOptions = this.normalizeOptions(uint8Array, options);
    const skipBytes = normOptions.position - this.position;
    if (skipBytes > 0) {
      await this.ignore(skipBytes);
      return this.readBuffer(uint8Array, options);
    }
    if (skipBytes < 0) {
      throw new Error("`options.position` must be equal or greater than `tokenizer.position`");
    }
    if (normOptions.length === 0) {
      return 0;
    }
    const bytesRead = await this.streamReader.read(uint8Array, normOptions.offset, normOptions.length);
    this.position += bytesRead;
    if ((!options || !options.mayBeLess) && bytesRead < normOptions.length) {
      throw new EndOfStreamError();
    }
    return bytesRead;
  }
  /**
   * Peek (read ahead) buffer from tokenizer
   * @param uint8Array - Uint8Array (or Buffer) to write data to
   * @param options - Read behaviour options
   * @returns Promise with number of bytes peeked
   */
  async peekBuffer(uint8Array, options) {
    const normOptions = this.normalizeOptions(uint8Array, options);
    let bytesRead = 0;
    if (normOptions.position) {
      const skipBytes = normOptions.position - this.position;
      if (skipBytes > 0) {
        const skipBuffer = new Uint8Array(normOptions.length + skipBytes);
        bytesRead = await this.peekBuffer(skipBuffer, { mayBeLess: normOptions.mayBeLess });
        uint8Array.set(skipBuffer.subarray(skipBytes), normOptions.offset);
        return bytesRead - skipBytes;
      }
      if (skipBytes < 0) {
        throw new Error("Cannot peek from a negative offset in a stream");
      }
    }
    if (normOptions.length > 0) {
      try {
        bytesRead = await this.streamReader.peek(uint8Array, normOptions.offset, normOptions.length);
      } catch (err2) {
        if ((options == null ? void 0 : options.mayBeLess) && err2 instanceof EndOfStreamError) {
          return 0;
        }
        throw err2;
      }
      if (!normOptions.mayBeLess && bytesRead < normOptions.length) {
        throw new EndOfStreamError();
      }
    }
    return bytesRead;
  }
  async ignore(length) {
    const bufSize = Math.min(maxBufferSize, length);
    const buf = new Uint8Array(bufSize);
    let totBytesRead = 0;
    while (totBytesRead < length) {
      const remaining = length - totBytesRead;
      const bytesRead = await this.readBuffer(buf, { length: Math.min(bufSize, remaining) });
      if (bytesRead < 0) {
        return bytesRead;
      }
      totBytesRead += bytesRead;
    }
    return totBytesRead;
  }
  abort() {
    return this.streamReader.abort();
  }
}
class BufferTokenizer extends AbstractTokenizer {
  /**
   * Construct BufferTokenizer
   * @param uint8Array - Uint8Array to tokenize
   * @param options Tokenizer options
   */
  constructor(uint8Array, options) {
    super(options);
    this.uint8Array = uint8Array;
    this.fileInfo.size = this.fileInfo.size ? this.fileInfo.size : uint8Array.length;
  }
  /**
   * Read buffer from tokenizer
   * @param uint8Array - Uint8Array to tokenize
   * @param options - Read behaviour options
   * @returns {Promise<number>}
   */
  async readBuffer(uint8Array, options) {
    if (options == null ? void 0 : options.position) {
      if (options.position < this.position) {
        throw new Error("`options.position` must be equal or greater than `tokenizer.position`");
      }
      this.position = options.position;
    }
    const bytesRead = await this.peekBuffer(uint8Array, options);
    this.position += bytesRead;
    return bytesRead;
  }
  /**
   * Peek (read ahead) buffer from tokenizer
   * @param uint8Array
   * @param options - Read behaviour options
   * @returns {Promise<number>}
   */
  async peekBuffer(uint8Array, options) {
    const normOptions = this.normalizeOptions(uint8Array, options);
    const bytes2read = Math.min(this.uint8Array.length - normOptions.position, normOptions.length);
    if (!normOptions.mayBeLess && bytes2read < normOptions.length) {
      throw new EndOfStreamError();
    }
    uint8Array.set(this.uint8Array.subarray(normOptions.position, normOptions.position + bytes2read), normOptions.offset);
    return bytes2read;
  }
  close() {
    return super.close();
  }
}
function fromWebStream(webStream, options) {
  return new ReadStreamTokenizer(new WebStreamReader(webStream), options);
}
function fromBuffer(uint8Array, options) {
  return new BufferTokenizer(uint8Array, options);
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var src = { exports: {} };
var browser = { exports: {} };
var ms;
var hasRequiredMs;
function requireMs() {
  if (hasRequiredMs) return ms;
  hasRequiredMs = 1;
  var s = 1e3;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  ms = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse2(val);
    } else if (type === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error(
      "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
    );
  };
  function parse2(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
      str
    );
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return void 0;
    }
  }
  function fmtShort(ms2) {
    var msAbs = Math.abs(ms2);
    if (msAbs >= d) {
      return Math.round(ms2 / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms2 / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms2 / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms2 / s) + "s";
    }
    return ms2 + "ms";
  }
  function fmtLong(ms2) {
    var msAbs = Math.abs(ms2);
    if (msAbs >= d) {
      return plural(ms2, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms2, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms2, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms2, msAbs, s, "second");
    }
    return ms2 + " ms";
  }
  function plural(ms2, msAbs, n, name2) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms2 / n) + " " + name2 + (isPlural ? "s" : "");
  }
  return ms;
}
var common;
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  function setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = requireMs();
    createDebug.destroy = destroy;
    Object.keys(env).forEach((key) => {
      createDebug[key] = env[key];
    });
    createDebug.names = [];
    createDebug.skips = [];
    createDebug.formatters = {};
    function selectColor(namespace) {
      let hash = 0;
      for (let i = 0; i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug2(...args) {
        if (!debug2.enabled) {
          return;
        }
        const self2 = debug2;
        const curr = Number(/* @__PURE__ */ new Date());
        const ms2 = curr - (prevTime || curr);
        self2.diff = ms2;
        self2.prev = prevTime;
        self2.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== "string") {
          args.unshift("%O");
        }
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format2) => {
          if (match === "%%") {
            return "%";
          }
          index++;
          const formatter = createDebug.formatters[format2];
          if (typeof formatter === "function") {
            const val = args[index];
            match = formatter.call(self2, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        createDebug.formatArgs.call(self2, args);
        const logFn = self2.log || createDebug.log;
        logFn.apply(self2, args);
      }
      debug2.namespace = namespace;
      debug2.useColors = createDebug.useColors();
      debug2.color = createDebug.selectColor(namespace);
      debug2.extend = extend;
      debug2.destroy = createDebug.destroy;
      Object.defineProperty(debug2, "enabled", {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) {
            return enableOverride;
          }
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: (v) => {
          enableOverride = v;
        }
      });
      if (typeof createDebug.init === "function") {
        createDebug.init(debug2);
      }
      return debug2;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
    function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      let i;
      const split = (typeof namespaces === "string" ? namespaces : "").split(/[\s,]+/);
      const len = split.length;
      for (i = 0; i < len; i++) {
        if (!split[i]) {
          continue;
        }
        namespaces = split[i].replace(/\*/g, ".*?");
        if (namespaces[0] === "-") {
          createDebug.skips.push(new RegExp("^" + namespaces.slice(1) + "$"));
        } else {
          createDebug.names.push(new RegExp("^" + namespaces + "$"));
        }
      }
    }
    function disable() {
      const namespaces = [
        ...createDebug.names.map(toNamespace),
        ...createDebug.skips.map(toNamespace).map((namespace) => "-" + namespace)
      ].join(",");
      createDebug.enable("");
      return namespaces;
    }
    function enabled(name2) {
      if (name2[name2.length - 1] === "*") {
        return true;
      }
      let i;
      let len;
      for (i = 0, len = createDebug.skips.length; i < len; i++) {
        if (createDebug.skips[i].test(name2)) {
          return false;
        }
      }
      for (i = 0, len = createDebug.names.length; i < len; i++) {
        if (createDebug.names[i].test(name2)) {
          return true;
        }
      }
      return false;
    }
    function toNamespace(regexp) {
      return regexp.toString().substring(2, regexp.toString().length - 2).replace(/\.\*\?$/, "*");
    }
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
    function destroy() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  common = setup;
  return common;
}
var hasRequiredBrowser;
function requireBrowser() {
  if (hasRequiredBrowser) return browser.exports;
  hasRequiredBrowser = 1;
  (function(module, exports) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module.exports = requireCommon()(exports);
    const { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  })(browser, browser.exports);
  return browser.exports;
}
var node$1 = { exports: {} };
var hasFlag;
var hasRequiredHasFlag;
function requireHasFlag() {
  if (hasRequiredHasFlag) return hasFlag;
  hasRequiredHasFlag = 1;
  hasFlag = (flag, argv = process.argv) => {
    const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
    const position = argv.indexOf(prefix + flag);
    const terminatorPosition = argv.indexOf("--");
    return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
  };
  return hasFlag;
}
var supportsColor_1;
var hasRequiredSupportsColor;
function requireSupportsColor() {
  if (hasRequiredSupportsColor) return supportsColor_1;
  hasRequiredSupportsColor = 1;
  const os2 = require$$0$1;
  const tty = require$$1;
  const hasFlag2 = requireHasFlag();
  const { env } = process;
  let forceColor;
  if (hasFlag2("no-color") || hasFlag2("no-colors") || hasFlag2("color=false") || hasFlag2("color=never")) {
    forceColor = 0;
  } else if (hasFlag2("color") || hasFlag2("colors") || hasFlag2("color=true") || hasFlag2("color=always")) {
    forceColor = 1;
  }
  if ("FORCE_COLOR" in env) {
    if (env.FORCE_COLOR === "true") {
      forceColor = 1;
    } else if (env.FORCE_COLOR === "false") {
      forceColor = 0;
    } else {
      forceColor = env.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(env.FORCE_COLOR, 10), 3);
    }
  }
  function translateLevel(level) {
    if (level === 0) {
      return false;
    }
    return {
      level,
      hasBasic: true,
      has256: level >= 2,
      has16m: level >= 3
    };
  }
  function supportsColor(haveStream, streamIsTTY) {
    if (forceColor === 0) {
      return 0;
    }
    if (hasFlag2("color=16m") || hasFlag2("color=full") || hasFlag2("color=truecolor")) {
      return 3;
    }
    if (hasFlag2("color=256")) {
      return 2;
    }
    if (haveStream && !streamIsTTY && forceColor === void 0) {
      return 0;
    }
    const min = forceColor || 0;
    if (env.TERM === "dumb") {
      return min;
    }
    if (process.platform === "win32") {
      const osRelease = os2.release().split(".");
      if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
        return Number(osRelease[2]) >= 14931 ? 3 : 2;
      }
      return 1;
    }
    if ("CI" in env) {
      if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
        return 1;
      }
      return min;
    }
    if ("TEAMCITY_VERSION" in env) {
      return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
    }
    if (env.COLORTERM === "truecolor") {
      return 3;
    }
    if ("TERM_PROGRAM" in env) {
      const version2 = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
      switch (env.TERM_PROGRAM) {
        case "iTerm.app":
          return version2 >= 3 ? 3 : 2;
        case "Apple_Terminal":
          return 2;
      }
    }
    if (/-256(color)?$/i.test(env.TERM)) {
      return 2;
    }
    if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
      return 1;
    }
    if ("COLORTERM" in env) {
      return 1;
    }
    return min;
  }
  function getSupportLevel(stream) {
    const level = supportsColor(stream, stream && stream.isTTY);
    return translateLevel(level);
  }
  supportsColor_1 = {
    supportsColor: getSupportLevel,
    stdout: translateLevel(supportsColor(true, tty.isatty(1))),
    stderr: translateLevel(supportsColor(true, tty.isatty(2)))
  };
  return supportsColor_1;
}
var hasRequiredNode;
function requireNode() {
  if (hasRequiredNode) return node$1.exports;
  hasRequiredNode = 1;
  (function(module, exports) {
    const tty = require$$1;
    const util = require$$1$1;
    exports.init = init;
    exports.log = log;
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.destroy = util.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    );
    exports.colors = [6, 2, 3, 4, 5, 1];
    try {
      const supportsColor = requireSupportsColor();
      if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
        exports.colors = [
          20,
          21,
          26,
          27,
          32,
          33,
          38,
          39,
          40,
          41,
          42,
          43,
          44,
          45,
          56,
          57,
          62,
          63,
          68,
          69,
          74,
          75,
          76,
          77,
          78,
          79,
          80,
          81,
          92,
          93,
          98,
          99,
          112,
          113,
          128,
          129,
          134,
          135,
          148,
          149,
          160,
          161,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          171,
          172,
          173,
          178,
          179,
          184,
          185,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          203,
          204,
          205,
          206,
          207,
          208,
          209,
          214,
          215,
          220,
          221
        ];
      }
    } catch (error) {
    }
    exports.inspectOpts = Object.keys(process.env).filter((key) => {
      return /^debug_/i.test(key);
    }).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
        return k.toUpperCase();
      });
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) {
        val = true;
      } else if (/^(no|off|false|disabled)$/i.test(val)) {
        val = false;
      } else if (val === "null") {
        val = null;
      } else {
        val = Number(val);
      }
      obj[prop] = val;
      return obj;
    }, {});
    function useColors() {
      return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
    }
    function formatArgs(args) {
      const { namespace: name2, useColors: useColors2 } = this;
      if (useColors2) {
        const c = this.color;
        const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name2} \x1B[0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = getDate() + name2 + " " + args[0];
      }
    }
    function getDate() {
      if (exports.inspectOpts.hideDate) {
        return "";
      }
      return (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function log(...args) {
      return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
    }
    function save(namespaces) {
      if (namespaces) {
        process.env.DEBUG = namespaces;
      } else {
        delete process.env.DEBUG;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function init(debug2) {
      debug2.inspectOpts = {};
      const keys = Object.keys(exports.inspectOpts);
      for (let i = 0; i < keys.length; i++) {
        debug2.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
      }
    }
    module.exports = requireCommon()(exports);
    const { formatters } = module.exports;
    formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
    };
    formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts);
    };
  })(node$1, node$1.exports);
  return node$1.exports;
}
if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) {
  src.exports = requireBrowser();
} else {
  src.exports = requireNode();
}
var srcExports = src.exports;
const initDebug = /* @__PURE__ */ getDefaultExportFromCjs(srcExports);
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
var read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m;
  var eLen = nBytes * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var nBits = -7;
  var i = isLE ? nBytes - 1 : 0;
  var d = isLE ? -1 : 1;
  var s = buffer[offset + i];
  i += d;
  e = s & (1 << -nBits) - 1;
  s >>= -nBits;
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {
  }
  m = e & (1 << -nBits) - 1;
  e >>= -nBits;
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {
  }
  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : (s ? -1 : 1) * Infinity;
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};
var write$2 = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c;
  var eLen = nBytes * 8 - mLen - 1;
  var eMax = (1 << eLen) - 1;
  var eBias = eMax >> 1;
  var rt = mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0;
  var i = isLE ? 0 : nBytes - 1;
  var d = isLE ? 1 : -1;
  var s = value < 0 || value === 0 && 1 / value < 0 ? 1 : 0;
  value = Math.abs(value);
  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }
    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }
  for (; mLen >= 8; buffer[offset + i] = m & 255, i += d, m /= 256, mLen -= 8) {
  }
  e = e << mLen | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 255, i += d, e /= 256, eLen -= 8) {
  }
  buffer[offset + i - d] |= s * 128;
};
function dv(array) {
  return new DataView(array.buffer, array.byteOffset);
}
const UINT8 = {
  len: 1,
  get(array, offset) {
    return dv(array).getUint8(offset);
  },
  put(array, offset, value) {
    dv(array).setUint8(offset, value);
    return offset + 1;
  }
};
const UINT16_LE = {
  len: 2,
  get(array, offset) {
    return dv(array).getUint16(offset, true);
  },
  put(array, offset, value) {
    dv(array).setUint16(offset, value, true);
    return offset + 2;
  }
};
const UINT16_BE = {
  len: 2,
  get(array, offset) {
    return dv(array).getUint16(offset);
  },
  put(array, offset, value) {
    dv(array).setUint16(offset, value);
    return offset + 2;
  }
};
const UINT24_LE = {
  len: 3,
  get(array, offset) {
    const dataView = dv(array);
    return dataView.getUint8(offset) + (dataView.getUint16(offset + 1, true) << 8);
  },
  put(array, offset, value) {
    const dataView = dv(array);
    dataView.setUint8(offset, value & 255);
    dataView.setUint16(offset + 1, value >> 8, true);
    return offset + 3;
  }
};
const UINT24_BE = {
  len: 3,
  get(array, offset) {
    const dataView = dv(array);
    return (dataView.getUint16(offset) << 8) + dataView.getUint8(offset + 2);
  },
  put(array, offset, value) {
    const dataView = dv(array);
    dataView.setUint16(offset, value >> 8);
    dataView.setUint8(offset + 2, value & 255);
    return offset + 3;
  }
};
const UINT32_LE = {
  len: 4,
  get(array, offset) {
    return dv(array).getUint32(offset, true);
  },
  put(array, offset, value) {
    dv(array).setUint32(offset, value, true);
    return offset + 4;
  }
};
const UINT32_BE = {
  len: 4,
  get(array, offset) {
    return dv(array).getUint32(offset);
  },
  put(array, offset, value) {
    dv(array).setUint32(offset, value);
    return offset + 4;
  }
};
const INT8 = {
  len: 1,
  get(array, offset) {
    return dv(array).getInt8(offset);
  },
  put(array, offset, value) {
    dv(array).setInt8(offset, value);
    return offset + 1;
  }
};
const INT16_BE = {
  len: 2,
  get(array, offset) {
    return dv(array).getInt16(offset);
  },
  put(array, offset, value) {
    dv(array).setInt16(offset, value);
    return offset + 2;
  }
};
const INT16_LE = {
  len: 2,
  get(array, offset) {
    return dv(array).getInt16(offset, true);
  },
  put(array, offset, value) {
    dv(array).setInt16(offset, value, true);
    return offset + 2;
  }
};
const INT24_LE = {
  len: 3,
  get(array, offset) {
    const unsigned = UINT24_LE.get(array, offset);
    return unsigned > 8388607 ? unsigned - 16777216 : unsigned;
  },
  put(array, offset, value) {
    const dataView = dv(array);
    dataView.setUint8(offset, value & 255);
    dataView.setUint16(offset + 1, value >> 8, true);
    return offset + 3;
  }
};
const INT24_BE = {
  len: 3,
  get(array, offset) {
    const unsigned = UINT24_BE.get(array, offset);
    return unsigned > 8388607 ? unsigned - 16777216 : unsigned;
  },
  put(array, offset, value) {
    const dataView = dv(array);
    dataView.setUint16(offset, value >> 8);
    dataView.setUint8(offset + 2, value & 255);
    return offset + 3;
  }
};
const INT32_BE = {
  len: 4,
  get(array, offset) {
    return dv(array).getInt32(offset);
  },
  put(array, offset, value) {
    dv(array).setInt32(offset, value);
    return offset + 4;
  }
};
const INT32_LE = {
  len: 4,
  get(array, offset) {
    return dv(array).getInt32(offset, true);
  },
  put(array, offset, value) {
    dv(array).setInt32(offset, value, true);
    return offset + 4;
  }
};
const UINT64_LE = {
  len: 8,
  get(array, offset) {
    return dv(array).getBigUint64(offset, true);
  },
  put(array, offset, value) {
    dv(array).setBigUint64(offset, value, true);
    return offset + 8;
  }
};
const INT64_LE = {
  len: 8,
  get(array, offset) {
    return dv(array).getBigInt64(offset, true);
  },
  put(array, offset, value) {
    dv(array).setBigInt64(offset, value, true);
    return offset + 8;
  }
};
const UINT64_BE = {
  len: 8,
  get(array, offset) {
    return dv(array).getBigUint64(offset);
  },
  put(array, offset, value) {
    dv(array).setBigUint64(offset, value);
    return offset + 8;
  }
};
const INT64_BE = {
  len: 8,
  get(array, offset) {
    return dv(array).getBigInt64(offset);
  },
  put(array, offset, value) {
    dv(array).setBigInt64(offset, value);
    return offset + 8;
  }
};
const Float16_BE = {
  len: 2,
  get(dataView, offset) {
    return read(dataView, offset, false, 10, this.len);
  },
  put(dataView, offset, value) {
    write$2(dataView, value, offset, false, 10, this.len);
    return offset + this.len;
  }
};
const Float16_LE = {
  len: 2,
  get(array, offset) {
    return read(array, offset, true, 10, this.len);
  },
  put(array, offset, value) {
    write$2(array, value, offset, true, 10, this.len);
    return offset + this.len;
  }
};
const Float32_BE = {
  len: 4,
  get(array, offset) {
    return dv(array).getFloat32(offset);
  },
  put(array, offset, value) {
    dv(array).setFloat32(offset, value);
    return offset + 4;
  }
};
const Float32_LE = {
  len: 4,
  get(array, offset) {
    return dv(array).getFloat32(offset, true);
  },
  put(array, offset, value) {
    dv(array).setFloat32(offset, value, true);
    return offset + 4;
  }
};
const Float64_BE = {
  len: 8,
  get(array, offset) {
    return dv(array).getFloat64(offset);
  },
  put(array, offset, value) {
    dv(array).setFloat64(offset, value);
    return offset + 8;
  }
};
const Float64_LE = {
  len: 8,
  get(array, offset) {
    return dv(array).getFloat64(offset, true);
  },
  put(array, offset, value) {
    dv(array).setFloat64(offset, value, true);
    return offset + 8;
  }
};
const Float80_BE = {
  len: 10,
  get(array, offset) {
    return read(array, offset, false, 63, this.len);
  },
  put(array, offset, value) {
    write$2(array, value, offset, false, 63, this.len);
    return offset + this.len;
  }
};
const Float80_LE = {
  len: 10,
  get(array, offset) {
    return read(array, offset, true, 63, this.len);
  },
  put(array, offset, value) {
    write$2(array, value, offset, true, 63, this.len);
    return offset + this.len;
  }
};
class IgnoreType {
  /**
   * @param len number of bytes to ignore
   */
  constructor(len) {
    this.len = len;
  }
  // ToDo: don't read, but skip data
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  get(array, off) {
  }
}
class Uint8ArrayType {
  constructor(len) {
    this.len = len;
  }
  get(array, offset) {
    return array.subarray(offset, offset + this.len);
  }
}
class StringType {
  constructor(len, encoding) {
    this.len = len;
    this.encoding = encoding;
    this.textDecoder = new TextDecoder(encoding);
  }
  get(uint8Array, offset) {
    return this.textDecoder.decode(uint8Array.subarray(offset, offset + this.len));
  }
}
class AnsiStringType {
  constructor(len) {
    this.len = len;
    this.textDecoder = new TextDecoder("windows-1252");
  }
  get(uint8Array, offset = 0) {
    return this.textDecoder.decode(uint8Array.subarray(offset, offset + this.len));
  }
}
const Token = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  AnsiStringType,
  Float16_BE,
  Float16_LE,
  Float32_BE,
  Float32_LE,
  Float64_BE,
  Float64_LE,
  Float80_BE,
  Float80_LE,
  INT16_BE,
  INT16_LE,
  INT24_BE,
  INT24_LE,
  INT32_BE,
  INT32_LE,
  INT64_BE,
  INT64_LE,
  INT8,
  IgnoreType,
  StringType,
  UINT16_BE,
  UINT16_LE,
  UINT24_BE,
  UINT24_LE,
  UINT32_BE,
  UINT32_LE,
  UINT64_BE,
  UINT64_LE,
  UINT8,
  Uint8ArrayType
}, Symbol.toStringTag, { value: "Module" }));
const objectToString = Object.prototype.toString;
const uint8ArrayStringified = "[object Uint8Array]";
const arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
function assertUint8Array(value) {
  if (!isUint8Array(value)) {
    throw new TypeError(`Expected \`Uint8Array\`, got \`${typeof value}\``);
  }
}
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
const cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function uint8ArrayToString(array, encoding = "utf8") {
  assertUint8ArrayOrArrayBuffer(array);
  cachedDecoders[encoding] ?? (cachedDecoders[encoding] = new globalThis.TextDecoder(encoding));
  return cachedDecoders[encoding].decode(array);
}
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
const cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
const MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8Array(array);
  let base64;
  if (array.length < MAX_BLOCK_SIZE) {
    base64 = globalThis.btoa(String.fromCodePoint.apply(this, array));
  } else {
    base64 = "";
    for (const value of array) {
      base64 += String.fromCodePoint(value);
    }
    base64 = globalThis.btoa(base64);
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
const byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));
function uint8ArrayToHex(array) {
  assertUint8Array(array);
  let hexString = "";
  for (let index = 0; index < array.length; index++) {
    hexString += byteToHexLookupTable[array[index]];
  }
  return hexString;
}
const hexToDecimalLookupTable = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  a: 10,
  b: 11,
  c: 12,
  d: 13,
  e: 14,
  f: 15,
  A: 10,
  B: 11,
  C: 12,
  D: 13,
  E: 14,
  F: 15
};
function hexToUint8Array(hexString) {
  assertString(hexString);
  if (hexString.length % 2 !== 0) {
    throw new Error("Invalid Hex string length.");
  }
  const resultLength = hexString.length / 2;
  const bytes = new Uint8Array(resultLength);
  for (let index = 0; index < resultLength; index++) {
    const highNibble = hexToDecimalLookupTable[hexString[index * 2]];
    const lowNibble = hexToDecimalLookupTable[hexString[index * 2 + 1]];
    if (highNibble === void 0 || lowNibble === void 0) {
      throw new Error(`Invalid Hex character encountered at position ${index * 2}`);
    }
    bytes[index] = highNibble << 4 | lowNibble;
  }
  return bytes;
}
function getUintBE(view) {
  const { byteLength } = view;
  if (byteLength === 6) {
    return view.getUint16(0) * 2 ** 32 + view.getUint32(2);
  }
  if (byteLength === 5) {
    return view.getUint8(0) * 2 ** 32 + view.getUint32(1);
  }
  if (byteLength === 4) {
    return view.getUint32(0);
  }
  if (byteLength === 3) {
    return view.getUint8(0) * 2 ** 16 + view.getUint16(1);
  }
  if (byteLength === 2) {
    return view.getUint16(0);
  }
  if (byteLength === 1) {
    return view.getUint8(0);
  }
}
function indexOf(array, value) {
  const arrayLength = array.length;
  const valueLength = value.length;
  if (valueLength === 0) {
    return -1;
  }
  if (valueLength > arrayLength) {
    return -1;
  }
  const validOffsetLength = arrayLength - valueLength;
  for (let index = 0; index <= validOffsetLength; index++) {
    let isMatch = true;
    for (let index2 = 0; index2 < valueLength; index2++) {
      if (array[index + index2] !== value[index2]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) {
      return index;
    }
  }
  return -1;
}
function includes(array, value) {
  return indexOf(array, value) !== -1;
}
function stringToBytes(string) {
  return [...string].map((character) => character.charCodeAt(0));
}
function tarHeaderChecksumMatches(arrayBuffer, offset = 0) {
  const readSum = Number.parseInt(new StringType(6).get(arrayBuffer, 148).replace(/\0.*$/, "").trim(), 8);
  if (Number.isNaN(readSum)) {
    return false;
  }
  let sum = 8 * 32;
  for (let index = offset; index < offset + 148; index++) {
    sum += arrayBuffer[index];
  }
  for (let index = offset + 156; index < offset + 512; index++) {
    sum += arrayBuffer[index];
  }
  return readSum === sum;
}
const uint32SyncSafeToken = {
  get: (buffer, offset) => buffer[offset + 3] & 127 | buffer[offset + 2] << 7 | buffer[offset + 1] << 14 | buffer[offset] << 21,
  len: 4
};
const extensions = [
  "jpg",
  "png",
  "apng",
  "gif",
  "webp",
  "flif",
  "xcf",
  "cr2",
  "cr3",
  "orf",
  "arw",
  "dng",
  "nef",
  "rw2",
  "raf",
  "tif",
  "bmp",
  "icns",
  "jxr",
  "psd",
  "indd",
  "zip",
  "tar",
  "rar",
  "gz",
  "bz2",
  "7z",
  "dmg",
  "mp4",
  "mid",
  "mkv",
  "webm",
  "mov",
  "avi",
  "mpg",
  "mp2",
  "mp3",
  "m4a",
  "oga",
  "ogg",
  "ogv",
  "opus",
  "flac",
  "wav",
  "spx",
  "amr",
  "pdf",
  "epub",
  "elf",
  "macho",
  "exe",
  "swf",
  "rtf",
  "wasm",
  "woff",
  "woff2",
  "eot",
  "ttf",
  "otf",
  "ico",
  "flv",
  "ps",
  "xz",
  "sqlite",
  "nes",
  "crx",
  "xpi",
  "cab",
  "deb",
  "ar",
  "rpm",
  "Z",
  "lz",
  "cfb",
  "mxf",
  "mts",
  "blend",
  "bpg",
  "docx",
  "pptx",
  "xlsx",
  "3gp",
  "3g2",
  "j2c",
  "jp2",
  "jpm",
  "jpx",
  "mj2",
  "aif",
  "qcp",
  "odt",
  "ods",
  "odp",
  "xml",
  "mobi",
  "heic",
  "cur",
  "ktx",
  "ape",
  "wv",
  "dcm",
  "ics",
  "glb",
  "pcap",
  "dsf",
  "lnk",
  "alias",
  "voc",
  "ac3",
  "m4v",
  "m4p",
  "m4b",
  "f4v",
  "f4p",
  "f4b",
  "f4a",
  "mie",
  "asf",
  "ogm",
  "ogx",
  "mpc",
  "arrow",
  "shp",
  "aac",
  "mp1",
  "it",
  "s3m",
  "xm",
  "ai",
  "skp",
  "avif",
  "eps",
  "lzh",
  "pgp",
  "asar",
  "stl",
  "chm",
  "3mf",
  "zst",
  "jxl",
  "vcf",
  "jls",
  "pst",
  "dwg",
  "parquet",
  "class",
  "arj",
  "cpio",
  "ace",
  "avro",
  "icc",
  "fbx",
  "vsdx",
  "vtt",
  "apk"
];
const mimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/flif",
  "image/x-xcf",
  "image/x-canon-cr2",
  "image/x-canon-cr3",
  "image/tiff",
  "image/bmp",
  "image/vnd.ms-photo",
  "image/vnd.adobe.photoshop",
  "application/x-indesign",
  "application/epub+zip",
  "application/x-xpinstall",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-tar",
  "application/x-rar-compressed",
  "application/gzip",
  "application/x-bzip2",
  "application/x-7z-compressed",
  "application/x-apple-diskimage",
  "application/x-apache-arrow",
  "video/mp4",
  "audio/midi",
  "video/x-matroska",
  "video/webm",
  "video/quicktime",
  "video/vnd.avi",
  "audio/wav",
  "audio/qcelp",
  "audio/x-ms-asf",
  "video/x-ms-asf",
  "application/vnd.ms-asf",
  "video/mpeg",
  "video/3gpp",
  "audio/mpeg",
  "audio/mp4",
  // RFC 4337
  "video/ogg",
  "audio/ogg",
  "audio/ogg; codecs=opus",
  "application/ogg",
  "audio/x-flac",
  "audio/ape",
  "audio/wavpack",
  "audio/amr",
  "application/pdf",
  "application/x-elf",
  "application/x-mach-binary",
  "application/x-msdownload",
  "application/x-shockwave-flash",
  "application/rtf",
  "application/wasm",
  "font/woff",
  "font/woff2",
  "application/vnd.ms-fontobject",
  "font/ttf",
  "font/otf",
  "image/x-icon",
  "video/x-flv",
  "application/postscript",
  "application/eps",
  "application/x-xz",
  "application/x-sqlite3",
  "application/x-nintendo-nes-rom",
  "application/x-google-chrome-extension",
  "application/vnd.ms-cab-compressed",
  "application/x-deb",
  "application/x-unix-archive",
  "application/x-rpm",
  "application/x-compress",
  "application/x-lzip",
  "application/x-cfb",
  "application/x-mie",
  "application/mxf",
  "video/mp2t",
  "application/x-blender",
  "image/bpg",
  "image/j2c",
  "image/jp2",
  "image/jpx",
  "image/jpm",
  "image/mj2",
  "audio/aiff",
  "application/xml",
  "application/x-mobipocket-ebook",
  "image/heif",
  "image/heif-sequence",
  "image/heic",
  "image/heic-sequence",
  "image/icns",
  "image/ktx",
  "application/dicom",
  "audio/x-musepack",
  "text/calendar",
  "text/vcard",
  "text/vtt",
  "model/gltf-binary",
  "application/vnd.tcpdump.pcap",
  "audio/x-dsf",
  // Non-standard
  "application/x.ms.shortcut",
  // Invented by us
  "application/x.apple.alias",
  // Invented by us
  "audio/x-voc",
  "audio/vnd.dolby.dd-raw",
  "audio/x-m4a",
  "image/apng",
  "image/x-olympus-orf",
  "image/x-sony-arw",
  "image/x-adobe-dng",
  "image/x-nikon-nef",
  "image/x-panasonic-rw2",
  "image/x-fujifilm-raf",
  "video/x-m4v",
  "video/3gpp2",
  "application/x-esri-shape",
  "audio/aac",
  "audio/x-it",
  "audio/x-s3m",
  "audio/x-xm",
  "video/MP1S",
  "video/MP2P",
  "application/vnd.sketchup.skp",
  "image/avif",
  "application/x-lzh-compressed",
  "application/pgp-encrypted",
  "application/x-asar",
  "model/stl",
  "application/vnd.ms-htmlhelp",
  "model/3mf",
  "image/jxl",
  "application/zstd",
  "image/jls",
  "application/vnd.ms-outlook",
  "image/vnd.dwg",
  "application/x-parquet",
  "application/java-vm",
  "application/x-arj",
  "application/x-cpio",
  "application/x-ace-compressed",
  "application/avro",
  "application/vnd.iccprofile",
  "application/x.autodesk.fbx",
  // Invented by us
  "application/vnd.visio",
  "application/vnd.android.package-archive"
];
const reasonableDetectionSizeInBytes = 4100;
async function fileTypeFromBuffer(input) {
  return new FileTypeParser().fromBuffer(input);
}
function _check(buffer, headers, options) {
  options = {
    offset: 0,
    ...options
  };
  for (const [index, header] of headers.entries()) {
    if (options.mask) {
      if (header !== (options.mask[index] & buffer[index + options.offset])) {
        return false;
      }
    } else if (header !== buffer[index + options.offset]) {
      return false;
    }
  }
  return true;
}
class FileTypeParser {
  constructor(options) {
    this.detectors = options == null ? void 0 : options.customDetectors;
    this.tokenizerOptions = {
      abortSignal: options == null ? void 0 : options.signal
    };
    this.fromTokenizer = this.fromTokenizer.bind(this);
    this.fromBuffer = this.fromBuffer.bind(this);
    this.parse = this.parse.bind(this);
  }
  async fromTokenizer(tokenizer) {
    const initialPosition = tokenizer.position;
    for (const detector of this.detectors || []) {
      const fileType = await detector(tokenizer);
      if (fileType) {
        return fileType;
      }
      if (initialPosition !== tokenizer.position) {
        return void 0;
      }
    }
    return this.parse(tokenizer);
  }
  async fromBuffer(input) {
    if (!(input instanceof Uint8Array || input instanceof ArrayBuffer)) {
      throw new TypeError(`Expected the \`input\` argument to be of type \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof input}\``);
    }
    const buffer = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!((buffer == null ? void 0 : buffer.length) > 1)) {
      return;
    }
    return this.fromTokenizer(fromBuffer(buffer, this.tokenizerOptions));
  }
  async fromBlob(blob) {
    return this.fromStream(blob.stream());
  }
  async fromStream(stream) {
    const tokenizer = await fromWebStream(stream, this.tokenizerOptions);
    try {
      return await this.fromTokenizer(tokenizer);
    } finally {
      await tokenizer.close();
    }
  }
  async toDetectionStream(stream, options) {
    const { sampleSize = reasonableDetectionSizeInBytes } = options;
    let detectedFileType;
    let firstChunk;
    const reader = stream.getReader({ mode: "byob" });
    try {
      const { value: chunk, done } = await reader.read(new Uint8Array(sampleSize));
      firstChunk = chunk;
      if (!done && chunk) {
        try {
          detectedFileType = await this.fromBuffer(chunk.slice(0, sampleSize));
        } catch (error) {
          if (!(error instanceof EndOfStreamError)) {
            throw error;
          }
          detectedFileType = void 0;
        }
      }
      firstChunk = chunk;
    } finally {
      reader.releaseLock();
    }
    const transformStream = new TransformStream({
      async start(controller) {
        controller.enqueue(firstChunk);
      },
      transform(chunk, controller) {
        controller.enqueue(chunk);
      }
    });
    const newStream = stream.pipeThrough(transformStream);
    newStream.fileType = detectedFileType;
    return newStream;
  }
  check(header, options) {
    return _check(this.buffer, header, options);
  }
  checkString(header, options) {
    return this.check(stringToBytes(header), options);
  }
  async parse(tokenizer) {
    this.buffer = new Uint8Array(reasonableDetectionSizeInBytes);
    if (tokenizer.fileInfo.size === void 0) {
      tokenizer.fileInfo.size = Number.MAX_SAFE_INTEGER;
    }
    this.tokenizer = tokenizer;
    await tokenizer.peekBuffer(this.buffer, { length: 12, mayBeLess: true });
    if (this.check([66, 77])) {
      return {
        ext: "bmp",
        mime: "image/bmp"
      };
    }
    if (this.check([11, 119])) {
      return {
        ext: "ac3",
        mime: "audio/vnd.dolby.dd-raw"
      };
    }
    if (this.check([120, 1])) {
      return {
        ext: "dmg",
        mime: "application/x-apple-diskimage"
      };
    }
    if (this.check([77, 90])) {
      return {
        ext: "exe",
        mime: "application/x-msdownload"
      };
    }
    if (this.check([37, 33])) {
      await tokenizer.peekBuffer(this.buffer, { length: 24, mayBeLess: true });
      if (this.checkString("PS-Adobe-", { offset: 2 }) && this.checkString(" EPSF-", { offset: 14 })) {
        return {
          ext: "eps",
          mime: "application/eps"
        };
      }
      return {
        ext: "ps",
        mime: "application/postscript"
      };
    }
    if (this.check([31, 160]) || this.check([31, 157])) {
      return {
        ext: "Z",
        mime: "application/x-compress"
      };
    }
    if (this.check([199, 113])) {
      return {
        ext: "cpio",
        mime: "application/x-cpio"
      };
    }
    if (this.check([96, 234])) {
      return {
        ext: "arj",
        mime: "application/x-arj"
      };
    }
    if (this.check([239, 187, 191])) {
      this.tokenizer.ignore(3);
      return this.parse(tokenizer);
    }
    if (this.check([71, 73, 70])) {
      return {
        ext: "gif",
        mime: "image/gif"
      };
    }
    if (this.check([73, 73, 188])) {
      return {
        ext: "jxr",
        mime: "image/vnd.ms-photo"
      };
    }
    if (this.check([31, 139, 8])) {
      return {
        ext: "gz",
        mime: "application/gzip"
      };
    }
    if (this.check([66, 90, 104])) {
      return {
        ext: "bz2",
        mime: "application/x-bzip2"
      };
    }
    if (this.checkString("ID3")) {
      await tokenizer.ignore(6);
      const id3HeaderLength = await tokenizer.readToken(uint32SyncSafeToken);
      if (tokenizer.position + id3HeaderLength > tokenizer.fileInfo.size) {
        return {
          ext: "mp3",
          mime: "audio/mpeg"
        };
      }
      await tokenizer.ignore(id3HeaderLength);
      return this.fromTokenizer(tokenizer);
    }
    if (this.checkString("MP+")) {
      return {
        ext: "mpc",
        mime: "audio/x-musepack"
      };
    }
    if ((this.buffer[0] === 67 || this.buffer[0] === 70) && this.check([87, 83], { offset: 1 })) {
      return {
        ext: "swf",
        mime: "application/x-shockwave-flash"
      };
    }
    if (this.check([255, 216, 255])) {
      if (this.check([247], { offset: 3 })) {
        return {
          ext: "jls",
          mime: "image/jls"
        };
      }
      return {
        ext: "jpg",
        mime: "image/jpeg"
      };
    }
    if (this.check([79, 98, 106, 1])) {
      return {
        ext: "avro",
        mime: "application/avro"
      };
    }
    if (this.checkString("FLIF")) {
      return {
        ext: "flif",
        mime: "image/flif"
      };
    }
    if (this.checkString("8BPS")) {
      return {
        ext: "psd",
        mime: "image/vnd.adobe.photoshop"
      };
    }
    if (this.checkString("WEBP", { offset: 8 })) {
      return {
        ext: "webp",
        mime: "image/webp"
      };
    }
    if (this.checkString("MPCK")) {
      return {
        ext: "mpc",
        mime: "audio/x-musepack"
      };
    }
    if (this.checkString("FORM")) {
      return {
        ext: "aif",
        mime: "audio/aiff"
      };
    }
    if (this.checkString("icns", { offset: 0 })) {
      return {
        ext: "icns",
        mime: "image/icns"
      };
    }
    if (this.check([80, 75, 3, 4])) {
      try {
        while (tokenizer.position + 30 < tokenizer.fileInfo.size) {
          await tokenizer.readBuffer(this.buffer, { length: 30 });
          const view = new DataView(this.buffer.buffer);
          const zipHeader = {
            compressedSize: view.getUint32(18, true),
            uncompressedSize: view.getUint32(22, true),
            filenameLength: view.getUint16(26, true),
            extraFieldLength: view.getUint16(28, true)
          };
          zipHeader.filename = await tokenizer.readToken(new StringType(zipHeader.filenameLength, "utf-8"));
          await tokenizer.ignore(zipHeader.extraFieldLength);
          if (/classes\d*\.dex/.test(zipHeader.filename)) {
            return {
              ext: "apk",
              mime: "application/vnd.android.package-archive"
            };
          }
          if (zipHeader.filename === "META-INF/mozilla.rsa") {
            return {
              ext: "xpi",
              mime: "application/x-xpinstall"
            };
          }
          if (zipHeader.filename.endsWith(".rels") || zipHeader.filename.endsWith(".xml")) {
            const type = zipHeader.filename.split("/")[0];
            switch (type) {
              case "_rels":
                break;
              case "word":
                return {
                  ext: "docx",
                  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                };
              case "ppt":
                return {
                  ext: "pptx",
                  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                };
              case "xl":
                return {
                  ext: "xlsx",
                  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                };
              case "visio":
                return {
                  ext: "vsdx",
                  mime: "application/vnd.visio"
                };
              default:
                break;
            }
          }
          if (zipHeader.filename.startsWith("xl/")) {
            return {
              ext: "xlsx",
              mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            };
          }
          if (zipHeader.filename.startsWith("3D/") && zipHeader.filename.endsWith(".model")) {
            return {
              ext: "3mf",
              mime: "model/3mf"
            };
          }
          if (zipHeader.filename === "mimetype" && zipHeader.compressedSize === zipHeader.uncompressedSize) {
            let mimeType = await tokenizer.readToken(new StringType(zipHeader.compressedSize, "utf-8"));
            mimeType = mimeType.trim();
            switch (mimeType) {
              case "application/epub+zip":
                return {
                  ext: "epub",
                  mime: "application/epub+zip"
                };
              case "application/vnd.oasis.opendocument.text":
                return {
                  ext: "odt",
                  mime: "application/vnd.oasis.opendocument.text"
                };
              case "application/vnd.oasis.opendocument.spreadsheet":
                return {
                  ext: "ods",
                  mime: "application/vnd.oasis.opendocument.spreadsheet"
                };
              case "application/vnd.oasis.opendocument.presentation":
                return {
                  ext: "odp",
                  mime: "application/vnd.oasis.opendocument.presentation"
                };
              default:
            }
          }
          if (zipHeader.compressedSize === 0) {
            let nextHeaderIndex = -1;
            while (nextHeaderIndex < 0 && tokenizer.position < tokenizer.fileInfo.size) {
              await tokenizer.peekBuffer(this.buffer, { mayBeLess: true });
              nextHeaderIndex = indexOf(this.buffer, new Uint8Array([80, 75, 3, 4]));
              await tokenizer.ignore(nextHeaderIndex >= 0 ? nextHeaderIndex : this.buffer.length);
            }
          } else {
            await tokenizer.ignore(zipHeader.compressedSize);
          }
        }
      } catch (error) {
        if (!(error instanceof EndOfStreamError)) {
          throw error;
        }
      }
      return {
        ext: "zip",
        mime: "application/zip"
      };
    }
    if (this.checkString("OggS")) {
      await tokenizer.ignore(28);
      const type = new Uint8Array(8);
      await tokenizer.readBuffer(type);
      if (_check(type, [79, 112, 117, 115, 72, 101, 97, 100])) {
        return {
          ext: "opus",
          mime: "audio/ogg; codecs=opus"
        };
      }
      if (_check(type, [128, 116, 104, 101, 111, 114, 97])) {
        return {
          ext: "ogv",
          mime: "video/ogg"
        };
      }
      if (_check(type, [1, 118, 105, 100, 101, 111, 0])) {
        return {
          ext: "ogm",
          mime: "video/ogg"
        };
      }
      if (_check(type, [127, 70, 76, 65, 67])) {
        return {
          ext: "oga",
          mime: "audio/ogg"
        };
      }
      if (_check(type, [83, 112, 101, 101, 120, 32, 32])) {
        return {
          ext: "spx",
          mime: "audio/ogg"
        };
      }
      if (_check(type, [1, 118, 111, 114, 98, 105, 115])) {
        return {
          ext: "ogg",
          mime: "audio/ogg"
        };
      }
      return {
        ext: "ogx",
        mime: "application/ogg"
      };
    }
    if (this.check([80, 75]) && (this.buffer[2] === 3 || this.buffer[2] === 5 || this.buffer[2] === 7) && (this.buffer[3] === 4 || this.buffer[3] === 6 || this.buffer[3] === 8)) {
      return {
        ext: "zip",
        mime: "application/zip"
      };
    }
    if (this.checkString("ftyp", { offset: 4 }) && (this.buffer[8] & 96) !== 0) {
      const brandMajor = new StringType(4, "latin1").get(this.buffer, 8).replace("\0", " ").trim();
      switch (brandMajor) {
        case "avif":
        case "avis":
          return { ext: "avif", mime: "image/avif" };
        case "mif1":
          return { ext: "heic", mime: "image/heif" };
        case "msf1":
          return { ext: "heic", mime: "image/heif-sequence" };
        case "heic":
        case "heix":
          return { ext: "heic", mime: "image/heic" };
        case "hevc":
        case "hevx":
          return { ext: "heic", mime: "image/heic-sequence" };
        case "qt":
          return { ext: "mov", mime: "video/quicktime" };
        case "M4V":
        case "M4VH":
        case "M4VP":
          return { ext: "m4v", mime: "video/x-m4v" };
        case "M4P":
          return { ext: "m4p", mime: "video/mp4" };
        case "M4B":
          return { ext: "m4b", mime: "audio/mp4" };
        case "M4A":
          return { ext: "m4a", mime: "audio/x-m4a" };
        case "F4V":
          return { ext: "f4v", mime: "video/mp4" };
        case "F4P":
          return { ext: "f4p", mime: "video/mp4" };
        case "F4A":
          return { ext: "f4a", mime: "audio/mp4" };
        case "F4B":
          return { ext: "f4b", mime: "audio/mp4" };
        case "crx":
          return { ext: "cr3", mime: "image/x-canon-cr3" };
        default:
          if (brandMajor.startsWith("3g")) {
            if (brandMajor.startsWith("3g2")) {
              return { ext: "3g2", mime: "video/3gpp2" };
            }
            return { ext: "3gp", mime: "video/3gpp" };
          }
          return { ext: "mp4", mime: "video/mp4" };
      }
    }
    if (this.checkString("MThd")) {
      return {
        ext: "mid",
        mime: "audio/midi"
      };
    }
    if (this.checkString("wOFF") && (this.check([0, 1, 0, 0], { offset: 4 }) || this.checkString("OTTO", { offset: 4 }))) {
      return {
        ext: "woff",
        mime: "font/woff"
      };
    }
    if (this.checkString("wOF2") && (this.check([0, 1, 0, 0], { offset: 4 }) || this.checkString("OTTO", { offset: 4 }))) {
      return {
        ext: "woff2",
        mime: "font/woff2"
      };
    }
    if (this.check([212, 195, 178, 161]) || this.check([161, 178, 195, 212])) {
      return {
        ext: "pcap",
        mime: "application/vnd.tcpdump.pcap"
      };
    }
    if (this.checkString("DSD ")) {
      return {
        ext: "dsf",
        mime: "audio/x-dsf"
        // Non-standard
      };
    }
    if (this.checkString("LZIP")) {
      return {
        ext: "lz",
        mime: "application/x-lzip"
      };
    }
    if (this.checkString("fLaC")) {
      return {
        ext: "flac",
        mime: "audio/x-flac"
      };
    }
    if (this.check([66, 80, 71, 251])) {
      return {
        ext: "bpg",
        mime: "image/bpg"
      };
    }
    if (this.checkString("wvpk")) {
      return {
        ext: "wv",
        mime: "audio/wavpack"
      };
    }
    if (this.checkString("%PDF")) {
      try {
        await tokenizer.ignore(1350);
        const maxBufferSize2 = 10 * 1024 * 1024;
        const buffer = new Uint8Array(Math.min(maxBufferSize2, tokenizer.fileInfo.size));
        await tokenizer.readBuffer(buffer, { mayBeLess: true });
        if (includes(buffer, new TextEncoder().encode("AIPrivateData"))) {
          return {
            ext: "ai",
            mime: "application/postscript"
          };
        }
      } catch (error) {
        if (!(error instanceof EndOfStreamError)) {
          throw error;
        }
      }
      return {
        ext: "pdf",
        mime: "application/pdf"
      };
    }
    if (this.check([0, 97, 115, 109])) {
      return {
        ext: "wasm",
        mime: "application/wasm"
      };
    }
    if (this.check([73, 73])) {
      const fileType = await this.readTiffHeader(false);
      if (fileType) {
        return fileType;
      }
    }
    if (this.check([77, 77])) {
      const fileType = await this.readTiffHeader(true);
      if (fileType) {
        return fileType;
      }
    }
    if (this.checkString("MAC ")) {
      return {
        ext: "ape",
        mime: "audio/ape"
      };
    }
    if (this.check([26, 69, 223, 163])) {
      async function readField() {
        const msb = await tokenizer.peekNumber(UINT8);
        let mask = 128;
        let ic = 0;
        while ((msb & mask) === 0 && mask !== 0) {
          ++ic;
          mask >>= 1;
        }
        const id = new Uint8Array(ic + 1);
        await tokenizer.readBuffer(id);
        return id;
      }
      async function readElement() {
        const idField = await readField();
        const lengthField = await readField();
        lengthField[0] ^= 128 >> lengthField.length - 1;
        const nrLength = Math.min(6, lengthField.length);
        const idView = new DataView(idField.buffer);
        const lengthView = new DataView(lengthField.buffer, lengthField.length - nrLength, nrLength);
        return {
          id: getUintBE(idView),
          len: getUintBE(lengthView)
        };
      }
      async function readChildren(children) {
        while (children > 0) {
          const element = await readElement();
          if (element.id === 17026) {
            const rawValue = await tokenizer.readToken(new StringType(element.len));
            return rawValue.replaceAll(/\00.*$/g, "");
          }
          await tokenizer.ignore(element.len);
          --children;
        }
      }
      const re = await readElement();
      const docType = await readChildren(re.len);
      switch (docType) {
        case "webm":
          return {
            ext: "webm",
            mime: "video/webm"
          };
        case "matroska":
          return {
            ext: "mkv",
            mime: "video/x-matroska"
          };
        default:
          return;
      }
    }
    if (this.check([82, 73, 70, 70])) {
      if (this.check([65, 86, 73], { offset: 8 })) {
        return {
          ext: "avi",
          mime: "video/vnd.avi"
        };
      }
      if (this.check([87, 65, 86, 69], { offset: 8 })) {
        return {
          ext: "wav",
          mime: "audio/wav"
        };
      }
      if (this.check([81, 76, 67, 77], { offset: 8 })) {
        return {
          ext: "qcp",
          mime: "audio/qcelp"
        };
      }
    }
    if (this.checkString("SQLi")) {
      return {
        ext: "sqlite",
        mime: "application/x-sqlite3"
      };
    }
    if (this.check([78, 69, 83, 26])) {
      return {
        ext: "nes",
        mime: "application/x-nintendo-nes-rom"
      };
    }
    if (this.checkString("Cr24")) {
      return {
        ext: "crx",
        mime: "application/x-google-chrome-extension"
      };
    }
    if (this.checkString("MSCF") || this.checkString("ISc(")) {
      return {
        ext: "cab",
        mime: "application/vnd.ms-cab-compressed"
      };
    }
    if (this.check([237, 171, 238, 219])) {
      return {
        ext: "rpm",
        mime: "application/x-rpm"
      };
    }
    if (this.check([197, 208, 211, 198])) {
      return {
        ext: "eps",
        mime: "application/eps"
      };
    }
    if (this.check([40, 181, 47, 253])) {
      return {
        ext: "zst",
        mime: "application/zstd"
      };
    }
    if (this.check([127, 69, 76, 70])) {
      return {
        ext: "elf",
        mime: "application/x-elf"
      };
    }
    if (this.check([33, 66, 68, 78])) {
      return {
        ext: "pst",
        mime: "application/vnd.ms-outlook"
      };
    }
    if (this.checkString("PAR1")) {
      return {
        ext: "parquet",
        mime: "application/x-parquet"
      };
    }
    if (this.check([207, 250, 237, 254])) {
      return {
        ext: "macho",
        mime: "application/x-mach-binary"
      };
    }
    if (this.check([79, 84, 84, 79, 0])) {
      return {
        ext: "otf",
        mime: "font/otf"
      };
    }
    if (this.checkString("#!AMR")) {
      return {
        ext: "amr",
        mime: "audio/amr"
      };
    }
    if (this.checkString("{\\rtf")) {
      return {
        ext: "rtf",
        mime: "application/rtf"
      };
    }
    if (this.check([70, 76, 86, 1])) {
      return {
        ext: "flv",
        mime: "video/x-flv"
      };
    }
    if (this.checkString("IMPM")) {
      return {
        ext: "it",
        mime: "audio/x-it"
      };
    }
    if (this.checkString("-lh0-", { offset: 2 }) || this.checkString("-lh1-", { offset: 2 }) || this.checkString("-lh2-", { offset: 2 }) || this.checkString("-lh3-", { offset: 2 }) || this.checkString("-lh4-", { offset: 2 }) || this.checkString("-lh5-", { offset: 2 }) || this.checkString("-lh6-", { offset: 2 }) || this.checkString("-lh7-", { offset: 2 }) || this.checkString("-lzs-", { offset: 2 }) || this.checkString("-lz4-", { offset: 2 }) || this.checkString("-lz5-", { offset: 2 }) || this.checkString("-lhd-", { offset: 2 })) {
      return {
        ext: "lzh",
        mime: "application/x-lzh-compressed"
      };
    }
    if (this.check([0, 0, 1, 186])) {
      if (this.check([33], { offset: 4, mask: [241] })) {
        return {
          ext: "mpg",
          // May also be .ps, .mpeg
          mime: "video/MP1S"
        };
      }
      if (this.check([68], { offset: 4, mask: [196] })) {
        return {
          ext: "mpg",
          // May also be .mpg, .m2p, .vob or .sub
          mime: "video/MP2P"
        };
      }
    }
    if (this.checkString("ITSF")) {
      return {
        ext: "chm",
        mime: "application/vnd.ms-htmlhelp"
      };
    }
    if (this.check([202, 254, 186, 190])) {
      return {
        ext: "class",
        mime: "application/java-vm"
      };
    }
    if (this.check([253, 55, 122, 88, 90, 0])) {
      return {
        ext: "xz",
        mime: "application/x-xz"
      };
    }
    if (this.checkString("<?xml ")) {
      return {
        ext: "xml",
        mime: "application/xml"
      };
    }
    if (this.check([55, 122, 188, 175, 39, 28])) {
      return {
        ext: "7z",
        mime: "application/x-7z-compressed"
      };
    }
    if (this.check([82, 97, 114, 33, 26, 7]) && (this.buffer[6] === 0 || this.buffer[6] === 1)) {
      return {
        ext: "rar",
        mime: "application/x-rar-compressed"
      };
    }
    if (this.checkString("solid ")) {
      return {
        ext: "stl",
        mime: "model/stl"
      };
    }
    if (this.checkString("AC")) {
      const version2 = new StringType(4, "latin1").get(this.buffer, 2);
      if (version2.match("^d*") && version2 >= 1e3 && version2 <= 1050) {
        return {
          ext: "dwg",
          mime: "image/vnd.dwg"
        };
      }
    }
    if (this.checkString("070707")) {
      return {
        ext: "cpio",
        mime: "application/x-cpio"
      };
    }
    if (this.checkString("BLENDER")) {
      return {
        ext: "blend",
        mime: "application/x-blender"
      };
    }
    if (this.checkString("!<arch>")) {
      await tokenizer.ignore(8);
      const string = await tokenizer.readToken(new StringType(13, "ascii"));
      if (string === "debian-binary") {
        return {
          ext: "deb",
          mime: "application/x-deb"
        };
      }
      return {
        ext: "ar",
        mime: "application/x-unix-archive"
      };
    }
    if (this.checkString("WEBVTT") && // One of LF, CR, tab, space, or end of file must follow "WEBVTT" per the spec (see `fixture/fixture-vtt-*.vtt` for examples). Note that `\0` is technically the null character (there is no such thing as an EOF character). However, checking for `\0` gives us the same result as checking for the end of the stream.
    ["\n", "\r", "	", " ", "\0"].some((char7) => this.checkString(char7, { offset: 6 }))) {
      return {
        ext: "vtt",
        mime: "text/vtt"
      };
    }
    if (this.check([137, 80, 78, 71, 13, 10, 26, 10])) {
      await tokenizer.ignore(8);
      async function readChunkHeader() {
        return {
          length: await tokenizer.readToken(INT32_BE),
          type: await tokenizer.readToken(new StringType(4, "latin1"))
        };
      }
      do {
        const chunk = await readChunkHeader();
        if (chunk.length < 0) {
          return;
        }
        switch (chunk.type) {
          case "IDAT":
            return {
              ext: "png",
              mime: "image/png"
            };
          case "acTL":
            return {
              ext: "apng",
              mime: "image/apng"
            };
          default:
            await tokenizer.ignore(chunk.length + 4);
        }
      } while (tokenizer.position + 8 < tokenizer.fileInfo.size);
      return {
        ext: "png",
        mime: "image/png"
      };
    }
    if (this.check([65, 82, 82, 79, 87, 49, 0, 0])) {
      return {
        ext: "arrow",
        mime: "application/x-apache-arrow"
      };
    }
    if (this.check([103, 108, 84, 70, 2, 0, 0, 0])) {
      return {
        ext: "glb",
        mime: "model/gltf-binary"
      };
    }
    if (this.check([102, 114, 101, 101], { offset: 4 }) || this.check([109, 100, 97, 116], { offset: 4 }) || this.check([109, 111, 111, 118], { offset: 4 }) || this.check([119, 105, 100, 101], { offset: 4 })) {
      return {
        ext: "mov",
        mime: "video/quicktime"
      };
    }
    if (this.check([73, 73, 82, 79, 8, 0, 0, 0, 24])) {
      return {
        ext: "orf",
        mime: "image/x-olympus-orf"
      };
    }
    if (this.checkString("gimp xcf ")) {
      return {
        ext: "xcf",
        mime: "image/x-xcf"
      };
    }
    if (this.check([73, 73, 85, 0, 24, 0, 0, 0, 136, 231, 116, 216])) {
      return {
        ext: "rw2",
        mime: "image/x-panasonic-rw2"
      };
    }
    if (this.check([48, 38, 178, 117, 142, 102, 207, 17, 166, 217])) {
      async function readHeader() {
        const guid = new Uint8Array(16);
        await tokenizer.readBuffer(guid);
        return {
          id: guid,
          size: Number(await tokenizer.readToken(UINT64_LE))
        };
      }
      await tokenizer.ignore(30);
      while (tokenizer.position + 24 < tokenizer.fileInfo.size) {
        const header = await readHeader();
        let payload = header.size - 24;
        if (_check(header.id, [145, 7, 220, 183, 183, 169, 207, 17, 142, 230, 0, 192, 12, 32, 83, 101])) {
          const typeId = new Uint8Array(16);
          payload -= await tokenizer.readBuffer(typeId);
          if (_check(typeId, [64, 158, 105, 248, 77, 91, 207, 17, 168, 253, 0, 128, 95, 92, 68, 43])) {
            return {
              ext: "asf",
              mime: "audio/x-ms-asf"
            };
          }
          if (_check(typeId, [192, 239, 25, 188, 77, 91, 207, 17, 168, 253, 0, 128, 95, 92, 68, 43])) {
            return {
              ext: "asf",
              mime: "video/x-ms-asf"
            };
          }
          break;
        }
        await tokenizer.ignore(payload);
      }
      return {
        ext: "asf",
        mime: "application/vnd.ms-asf"
      };
    }
    if (this.check([171, 75, 84, 88, 32, 49, 49, 187, 13, 10, 26, 10])) {
      return {
        ext: "ktx",
        mime: "image/ktx"
      };
    }
    if ((this.check([126, 16, 4]) || this.check([126, 24, 4])) && this.check([48, 77, 73, 69], { offset: 4 })) {
      return {
        ext: "mie",
        mime: "application/x-mie"
      };
    }
    if (this.check([39, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { offset: 2 })) {
      return {
        ext: "shp",
        mime: "application/x-esri-shape"
      };
    }
    if (this.check([255, 79, 255, 81])) {
      return {
        ext: "j2c",
        mime: "image/j2c"
      };
    }
    if (this.check([0, 0, 0, 12, 106, 80, 32, 32, 13, 10, 135, 10])) {
      await tokenizer.ignore(20);
      const type = await tokenizer.readToken(new StringType(4, "ascii"));
      switch (type) {
        case "jp2 ":
          return {
            ext: "jp2",
            mime: "image/jp2"
          };
        case "jpx ":
          return {
            ext: "jpx",
            mime: "image/jpx"
          };
        case "jpm ":
          return {
            ext: "jpm",
            mime: "image/jpm"
          };
        case "mjp2":
          return {
            ext: "mj2",
            mime: "image/mj2"
          };
        default:
          return;
      }
    }
    if (this.check([255, 10]) || this.check([0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10])) {
      return {
        ext: "jxl",
        mime: "image/jxl"
      };
    }
    if (this.check([254, 255])) {
      if (this.check([0, 60, 0, 63, 0, 120, 0, 109, 0, 108], { offset: 2 })) {
        return {
          ext: "xml",
          mime: "application/xml"
        };
      }
      return void 0;
    }
    if (this.check([0, 0, 1, 186]) || this.check([0, 0, 1, 179])) {
      return {
        ext: "mpg",
        mime: "video/mpeg"
      };
    }
    if (this.check([0, 1, 0, 0, 0])) {
      return {
        ext: "ttf",
        mime: "font/ttf"
      };
    }
    if (this.check([0, 0, 1, 0])) {
      return {
        ext: "ico",
        mime: "image/x-icon"
      };
    }
    if (this.check([0, 0, 2, 0])) {
      return {
        ext: "cur",
        mime: "image/x-icon"
      };
    }
    if (this.check([208, 207, 17, 224, 161, 177, 26, 225])) {
      return {
        ext: "cfb",
        mime: "application/x-cfb"
      };
    }
    await tokenizer.peekBuffer(this.buffer, { length: Math.min(256, tokenizer.fileInfo.size), mayBeLess: true });
    if (this.check([97, 99, 115, 112], { offset: 36 })) {
      return {
        ext: "icc",
        mime: "application/vnd.iccprofile"
      };
    }
    if (this.checkString("**ACE", { offset: 7 }) && this.checkString("**", { offset: 12 })) {
      return {
        ext: "ace",
        mime: "application/x-ace-compressed"
      };
    }
    if (this.checkString("BEGIN:")) {
      if (this.checkString("VCARD", { offset: 6 })) {
        return {
          ext: "vcf",
          mime: "text/vcard"
        };
      }
      if (this.checkString("VCALENDAR", { offset: 6 })) {
        return {
          ext: "ics",
          mime: "text/calendar"
        };
      }
    }
    if (this.checkString("FUJIFILMCCD-RAW")) {
      return {
        ext: "raf",
        mime: "image/x-fujifilm-raf"
      };
    }
    if (this.checkString("Extended Module:")) {
      return {
        ext: "xm",
        mime: "audio/x-xm"
      };
    }
    if (this.checkString("Creative Voice File")) {
      return {
        ext: "voc",
        mime: "audio/x-voc"
      };
    }
    if (this.check([4, 0, 0, 0]) && this.buffer.length >= 16) {
      const jsonSize = new DataView(this.buffer.buffer).getUint32(12, true);
      if (jsonSize > 12 && this.buffer.length >= jsonSize + 16) {
        try {
          const header = new TextDecoder().decode(this.buffer.slice(16, jsonSize + 16));
          const json = JSON.parse(header);
          if (json.files) {
            return {
              ext: "asar",
              mime: "application/x-asar"
            };
          }
        } catch {
        }
      }
    }
    if (this.check([6, 14, 43, 52, 2, 5, 1, 1, 13, 1, 2, 1, 1, 2])) {
      return {
        ext: "mxf",
        mime: "application/mxf"
      };
    }
    if (this.checkString("SCRM", { offset: 44 })) {
      return {
        ext: "s3m",
        mime: "audio/x-s3m"
      };
    }
    if (this.check([71]) && this.check([71], { offset: 188 })) {
      return {
        ext: "mts",
        mime: "video/mp2t"
      };
    }
    if (this.check([71], { offset: 4 }) && this.check([71], { offset: 196 })) {
      return {
        ext: "mts",
        mime: "video/mp2t"
      };
    }
    if (this.check([66, 79, 79, 75, 77, 79, 66, 73], { offset: 60 })) {
      return {
        ext: "mobi",
        mime: "application/x-mobipocket-ebook"
      };
    }
    if (this.check([68, 73, 67, 77], { offset: 128 })) {
      return {
        ext: "dcm",
        mime: "application/dicom"
      };
    }
    if (this.check([76, 0, 0, 0, 1, 20, 2, 0, 0, 0, 0, 0, 192, 0, 0, 0, 0, 0, 0, 70])) {
      return {
        ext: "lnk",
        mime: "application/x.ms.shortcut"
        // Invented by us
      };
    }
    if (this.check([98, 111, 111, 107, 0, 0, 0, 0, 109, 97, 114, 107, 0, 0, 0, 0])) {
      return {
        ext: "alias",
        mime: "application/x.apple.alias"
        // Invented by us
      };
    }
    if (this.checkString("Kaydara FBX Binary  \0")) {
      return {
        ext: "fbx",
        mime: "application/x.autodesk.fbx"
        // Invented by us
      };
    }
    if (this.check([76, 80], { offset: 34 }) && (this.check([0, 0, 1], { offset: 8 }) || this.check([1, 0, 2], { offset: 8 }) || this.check([2, 0, 2], { offset: 8 }))) {
      return {
        ext: "eot",
        mime: "application/vnd.ms-fontobject"
      };
    }
    if (this.check([6, 6, 237, 245, 216, 29, 70, 229, 189, 49, 239, 231, 254, 116, 183, 29])) {
      return {
        ext: "indd",
        mime: "application/x-indesign"
      };
    }
    await tokenizer.peekBuffer(this.buffer, { length: Math.min(512, tokenizer.fileInfo.size), mayBeLess: true });
    if (tarHeaderChecksumMatches(this.buffer)) {
      return {
        ext: "tar",
        mime: "application/x-tar"
      };
    }
    if (this.check([255, 254])) {
      if (this.check([60, 0, 63, 0, 120, 0, 109, 0, 108, 0], { offset: 2 })) {
        return {
          ext: "xml",
          mime: "application/xml"
        };
      }
      if (this.check([255, 14, 83, 0, 107, 0, 101, 0, 116, 0, 99, 0, 104, 0, 85, 0, 112, 0, 32, 0, 77, 0, 111, 0, 100, 0, 101, 0, 108, 0], { offset: 2 })) {
        return {
          ext: "skp",
          mime: "application/vnd.sketchup.skp"
        };
      }
      return void 0;
    }
    if (this.checkString("-----BEGIN PGP MESSAGE-----")) {
      return {
        ext: "pgp",
        mime: "application/pgp-encrypted"
      };
    }
    if (this.buffer.length >= 2 && this.check([255, 224], { offset: 0, mask: [255, 224] })) {
      if (this.check([16], { offset: 1, mask: [22] })) {
        if (this.check([8], { offset: 1, mask: [8] })) {
          return {
            ext: "aac",
            mime: "audio/aac"
          };
        }
        return {
          ext: "aac",
          mime: "audio/aac"
        };
      }
      if (this.check([2], { offset: 1, mask: [6] })) {
        return {
          ext: "mp3",
          mime: "audio/mpeg"
        };
      }
      if (this.check([4], { offset: 1, mask: [6] })) {
        return {
          ext: "mp2",
          mime: "audio/mpeg"
        };
      }
      if (this.check([6], { offset: 1, mask: [6] })) {
        return {
          ext: "mp1",
          mime: "audio/mpeg"
        };
      }
    }
  }
  async readTiffTag(bigEndian) {
    const tagId = await this.tokenizer.readToken(bigEndian ? UINT16_BE : UINT16_LE);
    this.tokenizer.ignore(10);
    switch (tagId) {
      case 50341:
        return {
          ext: "arw",
          mime: "image/x-sony-arw"
        };
      case 50706:
        return {
          ext: "dng",
          mime: "image/x-adobe-dng"
        };
    }
  }
  async readTiffIFD(bigEndian) {
    const numberOfTags = await this.tokenizer.readToken(bigEndian ? UINT16_BE : UINT16_LE);
    for (let n = 0; n < numberOfTags; ++n) {
      const fileType = await this.readTiffTag(bigEndian);
      if (fileType) {
        return fileType;
      }
    }
  }
  async readTiffHeader(bigEndian) {
    const version2 = (bigEndian ? UINT16_BE : UINT16_LE).get(this.buffer, 2);
    const ifdOffset = (bigEndian ? UINT32_BE : UINT32_LE).get(this.buffer, 4);
    if (version2 === 42) {
      if (ifdOffset >= 6) {
        if (this.checkString("CR", { offset: 8 })) {
          return {
            ext: "cr2",
            mime: "image/x-canon-cr2"
          };
        }
        if (ifdOffset >= 8 && (this.check([28, 0, 254, 0], { offset: 8 }) || this.check([31, 0, 11, 0], { offset: 8 }))) {
          return {
            ext: "nef",
            mime: "image/x-nikon-nef"
          };
        }
      }
      await this.tokenizer.ignore(ifdOffset);
      const fileType = await this.readTiffIFD(bigEndian);
      return fileType ?? {
        ext: "tif",
        mime: "image/tiff"
      };
    }
    if (version2 === 43) {
      return {
        ext: "tif",
        mime: "image/tiff"
      };
    }
  }
}
new Set(extensions);
new Set(mimeTypes);
var contentType = {};
/*!
 * content-type
 * Copyright(c) 2015 Douglas Christopher Wilson
 * MIT Licensed
 */
var PARAM_REGEXP = /; *([!#$%&'*+.^_`|~0-9A-Za-z-]+) *= *("(?:[\u000b\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\u000b\u0020-\u00ff])*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+) */g;
var TEXT_REGEXP = /^[\u000b\u0020-\u007e\u0080-\u00ff]+$/;
var TOKEN_REGEXP = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
var QESC_REGEXP = /\\([\u000b\u0020-\u00ff])/g;
var QUOTE_REGEXP = /([\\"])/g;
var TYPE_REGEXP$1 = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
contentType.format = format$2;
contentType.parse = parse$3;
function format$2(obj) {
  if (!obj || typeof obj !== "object") {
    throw new TypeError("argument obj is required");
  }
  var parameters = obj.parameters;
  var type = obj.type;
  if (!type || !TYPE_REGEXP$1.test(type)) {
    throw new TypeError("invalid type");
  }
  var string = type;
  if (parameters && typeof parameters === "object") {
    var param;
    var params = Object.keys(parameters).sort();
    for (var i = 0; i < params.length; i++) {
      param = params[i];
      if (!TOKEN_REGEXP.test(param)) {
        throw new TypeError("invalid parameter name");
      }
      string += "; " + param + "=" + qstring(parameters[param]);
    }
  }
  return string;
}
function parse$3(string) {
  if (!string) {
    throw new TypeError("argument string is required");
  }
  var header = typeof string === "object" ? getcontenttype(string) : string;
  if (typeof header !== "string") {
    throw new TypeError("argument string is required to be a string");
  }
  var index = header.indexOf(";");
  var type = index !== -1 ? header.slice(0, index).trim() : header.trim();
  if (!TYPE_REGEXP$1.test(type)) {
    throw new TypeError("invalid media type");
  }
  var obj = new ContentType(type.toLowerCase());
  if (index !== -1) {
    var key;
    var match;
    var value;
    PARAM_REGEXP.lastIndex = index;
    while (match = PARAM_REGEXP.exec(header)) {
      if (match.index !== index) {
        throw new TypeError("invalid parameter format");
      }
      index += match[0].length;
      key = match[1].toLowerCase();
      value = match[2];
      if (value.charCodeAt(0) === 34) {
        value = value.slice(1, -1);
        if (value.indexOf("\\") !== -1) {
          value = value.replace(QESC_REGEXP, "$1");
        }
      }
      obj.parameters[key] = value;
    }
    if (index !== header.length) {
      throw new TypeError("invalid parameter format");
    }
  }
  return obj;
}
function getcontenttype(obj) {
  var header;
  if (typeof obj.getHeader === "function") {
    header = obj.getHeader("content-type");
  } else if (typeof obj.headers === "object") {
    header = obj.headers && obj.headers["content-type"];
  }
  if (typeof header !== "string") {
    throw new TypeError("content-type header is missing from object");
  }
  return header;
}
function qstring(val) {
  var str = String(val);
  if (TOKEN_REGEXP.test(str)) {
    return str;
  }
  if (str.length > 0 && !TEXT_REGEXP.test(str)) {
    throw new TypeError("invalid parameter value");
  }
  return '"' + str.replace(QUOTE_REGEXP, "\\$1") + '"';
}
function ContentType(type) {
  this.parameters = /* @__PURE__ */ Object.create(null);
  this.type = type;
}
/*!
 * media-typer
 * Copyright(c) 2014-2017 Douglas Christopher Wilson
 * MIT Licensed
 */
var TYPE_REGEXP = /^ *([A-Za-z0-9][A-Za-z0-9!#$&^_-]{0,126})\/([A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}) *$/;
var parse_1$1 = parse$2;
function parse$2(string) {
  if (!string) {
    throw new TypeError("argument string is required");
  }
  if (typeof string !== "string") {
    throw new TypeError("argument string is required to be a string");
  }
  var match = TYPE_REGEXP.exec(string.toLowerCase());
  if (!match) {
    throw new TypeError("invalid media type");
  }
  var type = match[1];
  var subtype = match[2];
  var suffix;
  var index = subtype.lastIndexOf("+");
  if (index !== -1) {
    suffix = subtype.substr(index + 1);
    subtype = subtype.substr(0, index);
  }
  return new MediaType(type, subtype, suffix);
}
function MediaType(type, subtype, suffix) {
  this.type = type;
  this.subtype = subtype;
  this.suffix = suffix;
}
var TargetType;
(function(TargetType2) {
  TargetType2[TargetType2["shot"] = 10] = "shot";
  TargetType2[TargetType2["scene"] = 20] = "scene";
  TargetType2[TargetType2["track"] = 30] = "track";
  TargetType2[TargetType2["part"] = 40] = "part";
  TargetType2[TargetType2["album"] = 50] = "album";
  TargetType2[TargetType2["edition"] = 60] = "edition";
  TargetType2[TargetType2["collection"] = 70] = "collection";
})(TargetType || (TargetType = {}));
var TrackType;
(function(TrackType2) {
  TrackType2[TrackType2["video"] = 1] = "video";
  TrackType2[TrackType2["audio"] = 2] = "audio";
  TrackType2[TrackType2["complex"] = 3] = "complex";
  TrackType2[TrackType2["logo"] = 4] = "logo";
  TrackType2[TrackType2["subtitle"] = 17] = "subtitle";
  TrackType2[TrackType2["button"] = 18] = "button";
  TrackType2[TrackType2["control"] = 32] = "control";
})(TrackType || (TrackType = {}));
const makeParseError = (name2) => {
  return class ParseError extends Error {
    constructor(message) {
      super(message);
      this.name = name2;
    }
  };
};
class CouldNotDetermineFileTypeError extends makeParseError("CouldNotDetermineFileTypeError") {
}
class UnsupportedFileTypeError extends makeParseError("UnsupportedFileTypeError") {
}
class UnexpectedFileContentError extends makeParseError("UnexpectedFileContentError") {
  constructor(fileType, message) {
    super(message);
    this.fileType = fileType;
  }
  // Override toString to include file type information.
  toString() {
    return `${this.name} (FileType: ${this.fileType}): ${this.message}`;
  }
}
class FieldDecodingError extends makeParseError("FieldDecodingError") {
}
class InternalParserError extends makeParseError("InternalParserError") {
}
const makeUnexpectedFileContentError = (fileType) => {
  return class extends UnexpectedFileContentError {
    constructor(message) {
      super(fileType, message);
    }
  };
};
function getBit(buf, off, bit) {
  return (buf[off] & 1 << bit) !== 0;
}
function findZero(uint8Array, start, end, encoding) {
  let i = start;
  if (encoding === "utf-16le") {
    while (uint8Array[i] !== 0 || uint8Array[i + 1] !== 0) {
      if (i >= end)
        return end;
      i += 2;
    }
    return i;
  }
  while (uint8Array[i] !== 0) {
    if (i >= end)
      return end;
    i++;
  }
  return i;
}
function trimRightNull(x) {
  const pos0 = x.indexOf("\0");
  return pos0 === -1 ? x : x.substr(0, pos0);
}
function swapBytes(uint8Array) {
  const l = uint8Array.length;
  if ((l & 1) !== 0)
    throw new FieldDecodingError("Buffer length must be even");
  for (let i = 0; i < l; i += 2) {
    const a = uint8Array[i];
    uint8Array[i] = uint8Array[i + 1];
    uint8Array[i + 1] = a;
  }
  return uint8Array;
}
function decodeString(uint8Array, encoding) {
  if (uint8Array[0] === 255 && uint8Array[1] === 254) {
    return decodeString(uint8Array.subarray(2), encoding);
  }
  if (encoding === "utf-16le" && uint8Array[0] === 254 && uint8Array[1] === 255) {
    if ((uint8Array.length & 1) !== 0)
      throw new FieldDecodingError("Expected even number of octets for 16-bit unicode string");
    return decodeString(swapBytes(uint8Array), encoding);
  }
  return new StringType(uint8Array.length, encoding).get(uint8Array, 0);
}
function stripNulls(str) {
  str = str.replace(/^\x00+/g, "");
  str = str.replace(/\x00+$/g, "");
  return str;
}
function getBitAllignedNumber(source, byteOffset, bitOffset, len) {
  const byteOff = byteOffset + ~~(bitOffset / 8);
  const bitOff = bitOffset % 8;
  let value = source[byteOff];
  value &= 255 >> bitOff;
  const bitsRead = 8 - bitOff;
  const bitsLeft = len - bitsRead;
  if (bitsLeft < 0) {
    value >>= 8 - bitOff - len;
  } else if (bitsLeft > 0) {
    value <<= bitsLeft;
    value |= getBitAllignedNumber(source, byteOffset, bitOffset + bitsRead, bitsLeft);
  }
  return value;
}
function isBitSet$1(source, byteOffset, bitOffset) {
  return getBitAllignedNumber(source, byteOffset, bitOffset, 1) === 1;
}
function a2hex(str) {
  const arr = [];
  for (let i = 0, l = str.length; i < l; i++) {
    const hex = Number(str.charCodeAt(i)).toString(16);
    arr.push(hex.length === 1 ? `0${hex}` : hex);
  }
  return arr.join(" ");
}
function ratioToDb(ratio) {
  return 10 * Math.log10(ratio);
}
function dbToRatio(dB) {
  return 10 ** (dB / 10);
}
function toRatio(value) {
  const ps = value.split(" ").map((p) => p.trim().toLowerCase());
  if (ps.length >= 1) {
    const v = Number.parseFloat(ps[0]);
    return ps.length === 2 && ps[1] === "db" ? {
      dB: v,
      ratio: dbToRatio(v)
    } : {
      dB: ratioToDb(v),
      ratio: v
    };
  }
}
var AttachedPictureType;
(function(AttachedPictureType2) {
  AttachedPictureType2[AttachedPictureType2["Other"] = 0] = "Other";
  AttachedPictureType2[AttachedPictureType2["32x32 pixels 'file icon' (PNG only)"] = 1] = "32x32 pixels 'file icon' (PNG only)";
  AttachedPictureType2[AttachedPictureType2["Other file icon"] = 2] = "Other file icon";
  AttachedPictureType2[AttachedPictureType2["Cover (front)"] = 3] = "Cover (front)";
  AttachedPictureType2[AttachedPictureType2["Cover (back)"] = 4] = "Cover (back)";
  AttachedPictureType2[AttachedPictureType2["Leaflet page"] = 5] = "Leaflet page";
  AttachedPictureType2[AttachedPictureType2["Media (e.g. label side of CD)"] = 6] = "Media (e.g. label side of CD)";
  AttachedPictureType2[AttachedPictureType2["Lead artist/lead performer/soloist"] = 7] = "Lead artist/lead performer/soloist";
  AttachedPictureType2[AttachedPictureType2["Artist/performer"] = 8] = "Artist/performer";
  AttachedPictureType2[AttachedPictureType2["Conductor"] = 9] = "Conductor";
  AttachedPictureType2[AttachedPictureType2["Band/Orchestra"] = 10] = "Band/Orchestra";
  AttachedPictureType2[AttachedPictureType2["Composer"] = 11] = "Composer";
  AttachedPictureType2[AttachedPictureType2["Lyricist/text writer"] = 12] = "Lyricist/text writer";
  AttachedPictureType2[AttachedPictureType2["Recording Location"] = 13] = "Recording Location";
  AttachedPictureType2[AttachedPictureType2["During recording"] = 14] = "During recording";
  AttachedPictureType2[AttachedPictureType2["During performance"] = 15] = "During performance";
  AttachedPictureType2[AttachedPictureType2["Movie/video screen capture"] = 16] = "Movie/video screen capture";
  AttachedPictureType2[AttachedPictureType2["A bright coloured fish"] = 17] = "A bright coloured fish";
  AttachedPictureType2[AttachedPictureType2["Illustration"] = 18] = "Illustration";
  AttachedPictureType2[AttachedPictureType2["Band/artist logotype"] = 19] = "Band/artist logotype";
  AttachedPictureType2[AttachedPictureType2["Publisher/Studio logotype"] = 20] = "Publisher/Studio logotype";
})(AttachedPictureType || (AttachedPictureType = {}));
var LyricsContentType;
(function(LyricsContentType2) {
  LyricsContentType2[LyricsContentType2["other"] = 0] = "other";
  LyricsContentType2[LyricsContentType2["lyrics"] = 1] = "lyrics";
  LyricsContentType2[LyricsContentType2["text"] = 2] = "text";
  LyricsContentType2[LyricsContentType2["movement_part"] = 3] = "movement_part";
  LyricsContentType2[LyricsContentType2["events"] = 4] = "events";
  LyricsContentType2[LyricsContentType2["chord"] = 5] = "chord";
  LyricsContentType2[LyricsContentType2["trivia_pop"] = 6] = "trivia_pop";
})(LyricsContentType || (LyricsContentType = {}));
var TimestampFormat;
(function(TimestampFormat2) {
  TimestampFormat2[TimestampFormat2["notSynchronized0"] = 0] = "notSynchronized0";
  TimestampFormat2[TimestampFormat2["mpegFrameNumber"] = 1] = "mpegFrameNumber";
  TimestampFormat2[TimestampFormat2["milliseconds"] = 2] = "milliseconds";
})(TimestampFormat || (TimestampFormat = {}));
const UINT32SYNCSAFE = {
  get: (buf, off) => {
    return buf[off + 3] & 127 | buf[off + 2] << 7 | buf[off + 1] << 14 | buf[off] << 21;
  },
  len: 4
};
const ID3v2Header = {
  len: 10,
  get: (buf, off) => {
    return {
      // ID3v2/file identifier   "ID3"
      fileIdentifier: new StringType(3, "ascii").get(buf, off),
      // ID3v2 versionIndex
      version: {
        major: INT8.get(buf, off + 3),
        revision: INT8.get(buf, off + 4)
      },
      // ID3v2 flags
      flags: {
        // Unsynchronisation
        unsynchronisation: getBit(buf, off + 5, 7),
        // Extended header
        isExtendedHeader: getBit(buf, off + 5, 6),
        // Experimental indicator
        expIndicator: getBit(buf, off + 5, 5),
        footer: getBit(buf, off + 5, 4)
      },
      size: UINT32SYNCSAFE.get(buf, off + 6)
    };
  }
};
const ExtendedHeader = {
  len: 10,
  get: (buf, off) => {
    return {
      // Extended header size
      size: UINT32_BE.get(buf, off),
      // Extended Flags
      extendedFlags: UINT16_BE.get(buf, off + 4),
      // Size of padding
      sizeOfPadding: UINT32_BE.get(buf, off + 6),
      // CRC data present
      crcDataPresent: getBit(buf, off + 4, 31)
    };
  }
};
const TextEncodingToken = {
  len: 1,
  get: (uint8Array, off) => {
    switch (uint8Array[off]) {
      case 0:
        return { encoding: "latin1" };
      case 1:
        return { encoding: "utf-16le", bom: true };
      case 2:
        return { encoding: "utf-16le", bom: false };
      case 3:
        return { encoding: "utf8", bom: false };
      default:
        return { encoding: "utf8", bom: false };
    }
  }
};
const TextHeader = {
  len: 4,
  get: (uint8Array, off) => {
    return {
      encoding: TextEncodingToken.get(uint8Array, off),
      language: new StringType(3, "latin1").get(uint8Array, off + 1)
    };
  }
};
const SyncTextHeader = {
  len: 6,
  get: (uint8Array, off) => {
    const text = TextHeader.get(uint8Array, off);
    return {
      encoding: text.encoding,
      language: text.language,
      timeStampFormat: UINT8.get(uint8Array, off + 4),
      contentType: UINT8.get(uint8Array, off + 5)
    };
  }
};
const commonTags = {
  year: { multiple: false },
  track: { multiple: false },
  disk: { multiple: false },
  title: { multiple: false },
  artist: { multiple: false },
  artists: { multiple: true, unique: true },
  albumartist: { multiple: false },
  album: { multiple: false },
  date: { multiple: false },
  originaldate: { multiple: false },
  originalyear: { multiple: false },
  releasedate: { multiple: false },
  comment: { multiple: true, unique: false },
  genre: { multiple: true, unique: true },
  picture: { multiple: true, unique: true },
  composer: { multiple: true, unique: true },
  lyrics: { multiple: true, unique: false },
  albumsort: { multiple: false, unique: true },
  titlesort: { multiple: false, unique: true },
  work: { multiple: false, unique: true },
  artistsort: { multiple: false, unique: true },
  albumartistsort: { multiple: false, unique: true },
  composersort: { multiple: false, unique: true },
  lyricist: { multiple: true, unique: true },
  writer: { multiple: true, unique: true },
  conductor: { multiple: true, unique: true },
  remixer: { multiple: true, unique: true },
  arranger: { multiple: true, unique: true },
  engineer: { multiple: true, unique: true },
  producer: { multiple: true, unique: true },
  technician: { multiple: true, unique: true },
  djmixer: { multiple: true, unique: true },
  mixer: { multiple: true, unique: true },
  label: { multiple: true, unique: true },
  grouping: { multiple: false },
  subtitle: { multiple: true },
  discsubtitle: { multiple: false },
  totaltracks: { multiple: false },
  totaldiscs: { multiple: false },
  compilation: { multiple: false },
  rating: { multiple: true },
  bpm: { multiple: false },
  mood: { multiple: false },
  media: { multiple: false },
  catalognumber: { multiple: true, unique: true },
  tvShow: { multiple: false },
  tvShowSort: { multiple: false },
  tvSeason: { multiple: false },
  tvEpisode: { multiple: false },
  tvEpisodeId: { multiple: false },
  tvNetwork: { multiple: false },
  podcast: { multiple: false },
  podcasturl: { multiple: false },
  releasestatus: { multiple: false },
  releasetype: { multiple: true },
  releasecountry: { multiple: false },
  script: { multiple: false },
  language: { multiple: false },
  copyright: { multiple: false },
  license: { multiple: false },
  encodedby: { multiple: false },
  encodersettings: { multiple: false },
  gapless: { multiple: false },
  barcode: { multiple: false },
  isrc: { multiple: true },
  asin: { multiple: false },
  musicbrainz_recordingid: { multiple: false },
  musicbrainz_trackid: { multiple: false },
  musicbrainz_albumid: { multiple: false },
  musicbrainz_artistid: { multiple: true },
  musicbrainz_albumartistid: { multiple: true },
  musicbrainz_releasegroupid: { multiple: false },
  musicbrainz_workid: { multiple: false },
  musicbrainz_trmid: { multiple: false },
  musicbrainz_discid: { multiple: false },
  acoustid_id: { multiple: false },
  acoustid_fingerprint: { multiple: false },
  musicip_puid: { multiple: false },
  musicip_fingerprint: { multiple: false },
  website: { multiple: false },
  "performer:instrument": { multiple: true, unique: true },
  averageLevel: { multiple: false },
  peakLevel: { multiple: false },
  notes: { multiple: true, unique: false },
  key: { multiple: false },
  originalalbum: { multiple: false },
  originalartist: { multiple: false },
  discogs_artist_id: { multiple: true, unique: true },
  discogs_release_id: { multiple: false },
  discogs_label_id: { multiple: false },
  discogs_master_release_id: { multiple: false },
  discogs_votes: { multiple: false },
  discogs_rating: { multiple: false },
  replaygain_track_peak: { multiple: false },
  replaygain_track_gain: { multiple: false },
  replaygain_album_peak: { multiple: false },
  replaygain_album_gain: { multiple: false },
  replaygain_track_minmax: { multiple: false },
  replaygain_album_minmax: { multiple: false },
  replaygain_undo: { multiple: false },
  description: { multiple: true },
  longDescription: { multiple: false },
  category: { multiple: true },
  hdVideo: { multiple: false },
  keywords: { multiple: true },
  movement: { multiple: false },
  movementIndex: { multiple: false },
  movementTotal: { multiple: false },
  podcastId: { multiple: false },
  showMovement: { multiple: false },
  stik: { multiple: false }
};
function isSingleton(alias) {
  return commonTags[alias] && !commonTags[alias].multiple;
}
function isUnique(alias) {
  return !commonTags[alias].multiple || commonTags[alias].unique || false;
}
class CommonTagMapper {
  static toIntOrNull(str) {
    const cleaned = Number.parseInt(str, 10);
    return Number.isNaN(cleaned) ? null : cleaned;
  }
  // TODO: a string of 1of1 would fail to be converted
  // converts 1/10 to no : 1, of : 10
  // or 1 to no : 1, of : 0
  static normalizeTrack(origVal) {
    const split = origVal.toString().split("/");
    return {
      no: Number.parseInt(split[0], 10) || null,
      of: Number.parseInt(split[1], 10) || null
    };
  }
  constructor(tagTypes, tagMap2) {
    this.tagTypes = tagTypes;
    this.tagMap = tagMap2;
  }
  /**
   * Process and set common tags
   * write common tags to
   * @param tag Native tag
   * @param warnings Register warnings
   * @return common name
   */
  mapGenericTag(tag, warnings) {
    tag = { id: tag.id, value: tag.value };
    this.postMap(tag, warnings);
    const id = this.getCommonName(tag.id);
    return id ? { id, value: tag.value } : null;
  }
  /**
   * Convert native tag key to common tag key
   * @param tag Native header tag
   * @return common tag name (alias)
   */
  getCommonName(tag) {
    return this.tagMap[tag];
  }
  /**
   * Handle post mapping exceptions / correction
   * @param tag Tag e.g. {"©alb", "Buena Vista Social Club")
   * @param warnings Used to register warnings
   */
  postMap(tag, warnings) {
    return;
  }
}
CommonTagMapper.maxRatingScore = 1;
const id3v1TagMap = {
  title: "title",
  artist: "artist",
  album: "album",
  year: "year",
  comment: "comment",
  track: "track",
  genre: "genre"
};
class ID3v1TagMapper extends CommonTagMapper {
  constructor() {
    super(["ID3v1"], id3v1TagMap);
  }
}
class CaseInsensitiveTagMap extends CommonTagMapper {
  constructor(tagTypes, tagMap2) {
    const upperCaseMap = {};
    for (const tag of Object.keys(tagMap2)) {
      upperCaseMap[tag.toUpperCase()] = tagMap2[tag];
    }
    super(tagTypes, upperCaseMap);
  }
  /**
   * @tag  Native header tag
   * @return common tag name (alias)
   */
  getCommonName(tag) {
    return this.tagMap[tag.toUpperCase()];
  }
}
const id3v24TagMap = {
  // id3v2.3
  TIT2: "title",
  TPE1: "artist",
  "TXXX:Artists": "artists",
  TPE2: "albumartist",
  TALB: "album",
  TDRV: "date",
  // [ 'date', 'year' ] ToDo: improve 'year' mapping
  /**
   * Original release year
   */
  TORY: "originalyear",
  TPOS: "disk",
  TCON: "genre",
  APIC: "picture",
  TCOM: "composer",
  USLT: "lyrics",
  TSOA: "albumsort",
  TSOT: "titlesort",
  TOAL: "originalalbum",
  TSOP: "artistsort",
  TSO2: "albumartistsort",
  TSOC: "composersort",
  TEXT: "lyricist",
  "TXXX:Writer": "writer",
  TPE3: "conductor",
  // 'IPLS:instrument': 'performer:instrument', // ToDo
  TPE4: "remixer",
  "IPLS:arranger": "arranger",
  "IPLS:engineer": "engineer",
  "IPLS:producer": "producer",
  "IPLS:DJ-mix": "djmixer",
  "IPLS:mix": "mixer",
  TPUB: "label",
  TIT1: "grouping",
  TIT3: "subtitle",
  TRCK: "track",
  TCMP: "compilation",
  POPM: "rating",
  TBPM: "bpm",
  TMED: "media",
  "TXXX:CATALOGNUMBER": "catalognumber",
  "TXXX:MusicBrainz Album Status": "releasestatus",
  "TXXX:MusicBrainz Album Type": "releasetype",
  /**
   * Release country as documented: https://picard.musicbrainz.org/docs/mappings/#cite_note-0
   */
  "TXXX:MusicBrainz Album Release Country": "releasecountry",
  /**
   * Release country as implemented // ToDo: report
   */
  "TXXX:RELEASECOUNTRY": "releasecountry",
  "TXXX:SCRIPT": "script",
  TLAN: "language",
  TCOP: "copyright",
  WCOP: "license",
  TENC: "encodedby",
  TSSE: "encodersettings",
  "TXXX:BARCODE": "barcode",
  "TXXX:ISRC": "isrc",
  TSRC: "isrc",
  "TXXX:ASIN": "asin",
  "TXXX:originalyear": "originalyear",
  "UFID:http://musicbrainz.org": "musicbrainz_recordingid",
  "TXXX:MusicBrainz Release Track Id": "musicbrainz_trackid",
  "TXXX:MusicBrainz Album Id": "musicbrainz_albumid",
  "TXXX:MusicBrainz Artist Id": "musicbrainz_artistid",
  "TXXX:MusicBrainz Album Artist Id": "musicbrainz_albumartistid",
  "TXXX:MusicBrainz Release Group Id": "musicbrainz_releasegroupid",
  "TXXX:MusicBrainz Work Id": "musicbrainz_workid",
  "TXXX:MusicBrainz TRM Id": "musicbrainz_trmid",
  "TXXX:MusicBrainz Disc Id": "musicbrainz_discid",
  "TXXX:ACOUSTID_ID": "acoustid_id",
  "TXXX:Acoustid Id": "acoustid_id",
  "TXXX:Acoustid Fingerprint": "acoustid_fingerprint",
  "TXXX:MusicIP PUID": "musicip_puid",
  "TXXX:MusicMagic Fingerprint": "musicip_fingerprint",
  WOAR: "website",
  // id3v2.4
  // ToDo: In same sequence as defined at http://id3.org/id3v2.4.0-frames
  TDRC: "date",
  // date YYYY-MM-DD
  TYER: "year",
  TDOR: "originaldate",
  // 'TMCL:instrument': 'performer:instrument',
  "TIPL:arranger": "arranger",
  "TIPL:engineer": "engineer",
  "TIPL:producer": "producer",
  "TIPL:DJ-mix": "djmixer",
  "TIPL:mix": "mixer",
  TMOO: "mood",
  // additional mappings:
  SYLT: "lyrics",
  TSST: "discsubtitle",
  TKEY: "key",
  COMM: "comment",
  TOPE: "originalartist",
  // Windows Media Player
  "PRIV:AverageLevel": "averageLevel",
  "PRIV:PeakLevel": "peakLevel",
  // Discogs
  "TXXX:DISCOGS_ARTIST_ID": "discogs_artist_id",
  "TXXX:DISCOGS_ARTISTS": "artists",
  "TXXX:DISCOGS_ARTIST_NAME": "artists",
  "TXXX:DISCOGS_ALBUM_ARTISTS": "albumartist",
  "TXXX:DISCOGS_CATALOG": "catalognumber",
  "TXXX:DISCOGS_COUNTRY": "releasecountry",
  "TXXX:DISCOGS_DATE": "originaldate",
  "TXXX:DISCOGS_LABEL": "label",
  "TXXX:DISCOGS_LABEL_ID": "discogs_label_id",
  "TXXX:DISCOGS_MASTER_RELEASE_ID": "discogs_master_release_id",
  "TXXX:DISCOGS_RATING": "discogs_rating",
  "TXXX:DISCOGS_RELEASED": "date",
  "TXXX:DISCOGS_RELEASE_ID": "discogs_release_id",
  "TXXX:DISCOGS_VOTES": "discogs_votes",
  "TXXX:CATALOGID": "catalognumber",
  "TXXX:STYLE": "genre",
  "TXXX:REPLAYGAIN_TRACK_PEAK": "replaygain_track_peak",
  "TXXX:REPLAYGAIN_TRACK_GAIN": "replaygain_track_gain",
  "TXXX:REPLAYGAIN_ALBUM_PEAK": "replaygain_album_peak",
  "TXXX:REPLAYGAIN_ALBUM_GAIN": "replaygain_album_gain",
  "TXXX:MP3GAIN_MINMAX": "replaygain_track_minmax",
  "TXXX:MP3GAIN_ALBUM_MINMAX": "replaygain_album_minmax",
  "TXXX:MP3GAIN_UNDO": "replaygain_undo",
  MVNM: "movement",
  MVIN: "movementIndex",
  PCST: "podcast",
  TCAT: "category",
  TDES: "description",
  TDRL: "releasedate",
  TGID: "podcastId",
  TKWD: "keywords",
  WFED: "podcasturl",
  GRP1: "grouping"
};
class ID3v24TagMapper extends CaseInsensitiveTagMap {
  static toRating(popm) {
    return {
      source: popm.email,
      rating: popm.rating > 0 ? (popm.rating - 1) / 254 * CommonTagMapper.maxRatingScore : void 0
    };
  }
  constructor() {
    super(["ID3v2.3", "ID3v2.4"], id3v24TagMap);
  }
  /**
   * Handle post mapping exceptions / correction
   * @param tag to post map
   * @param warnings Wil be used to register (collect) warnings
   */
  postMap(tag, warnings) {
    switch (tag.id) {
      case "UFID":
        {
          const idTag = tag.value;
          if (idTag.owner_identifier === "http://musicbrainz.org") {
            tag.id += `:${idTag.owner_identifier}`;
            tag.value = decodeString(idTag.identifier, "latin1");
          }
        }
        break;
      case "PRIV":
        {
          const customTag = tag.value;
          switch (customTag.owner_identifier) {
            case "AverageLevel":
            case "PeakValue":
              tag.id += `:${customTag.owner_identifier}`;
              tag.value = customTag.data.length === 4 ? UINT32_LE.get(customTag.data, 0) : null;
              if (tag.value === null) {
                warnings.addWarning("Failed to parse PRIV:PeakValue");
              }
              break;
            default:
              warnings.addWarning(`Unknown PRIV owner-identifier: ${customTag.data}`);
          }
        }
        break;
      case "POPM":
        tag.value = ID3v24TagMapper.toRating(tag.value);
        break;
    }
  }
}
const asfTagMap = {
  Title: "title",
  Author: "artist",
  "WM/AlbumArtist": "albumartist",
  "WM/AlbumTitle": "album",
  "WM/Year": "date",
  // changed to 'year' to 'date' based on Picard mappings; ToDo: check me
  "WM/OriginalReleaseTime": "originaldate",
  "WM/OriginalReleaseYear": "originalyear",
  Description: "comment",
  "WM/TrackNumber": "track",
  "WM/PartOfSet": "disk",
  "WM/Genre": "genre",
  "WM/Composer": "composer",
  "WM/Lyrics": "lyrics",
  "WM/AlbumSortOrder": "albumsort",
  "WM/TitleSortOrder": "titlesort",
  "WM/ArtistSortOrder": "artistsort",
  "WM/AlbumArtistSortOrder": "albumartistsort",
  "WM/ComposerSortOrder": "composersort",
  "WM/Writer": "lyricist",
  "WM/Conductor": "conductor",
  "WM/ModifiedBy": "remixer",
  "WM/Engineer": "engineer",
  "WM/Producer": "producer",
  "WM/DJMixer": "djmixer",
  "WM/Mixer": "mixer",
  "WM/Publisher": "label",
  "WM/ContentGroupDescription": "grouping",
  "WM/SubTitle": "subtitle",
  "WM/SetSubTitle": "discsubtitle",
  // 'WM/PartOfSet': 'totaldiscs',
  "WM/IsCompilation": "compilation",
  "WM/SharedUserRating": "rating",
  "WM/BeatsPerMinute": "bpm",
  "WM/Mood": "mood",
  "WM/Media": "media",
  "WM/CatalogNo": "catalognumber",
  "MusicBrainz/Album Status": "releasestatus",
  "MusicBrainz/Album Type": "releasetype",
  "MusicBrainz/Album Release Country": "releasecountry",
  "WM/Script": "script",
  "WM/Language": "language",
  Copyright: "copyright",
  LICENSE: "license",
  "WM/EncodedBy": "encodedby",
  "WM/EncodingSettings": "encodersettings",
  "WM/Barcode": "barcode",
  "WM/ISRC": "isrc",
  "MusicBrainz/Track Id": "musicbrainz_recordingid",
  "MusicBrainz/Release Track Id": "musicbrainz_trackid",
  "MusicBrainz/Album Id": "musicbrainz_albumid",
  "MusicBrainz/Artist Id": "musicbrainz_artistid",
  "MusicBrainz/Album Artist Id": "musicbrainz_albumartistid",
  "MusicBrainz/Release Group Id": "musicbrainz_releasegroupid",
  "MusicBrainz/Work Id": "musicbrainz_workid",
  "MusicBrainz/TRM Id": "musicbrainz_trmid",
  "MusicBrainz/Disc Id": "musicbrainz_discid",
  "Acoustid/Id": "acoustid_id",
  "Acoustid/Fingerprint": "acoustid_fingerprint",
  "MusicIP/PUID": "musicip_puid",
  "WM/ARTISTS": "artists",
  "WM/InitialKey": "key",
  ASIN: "asin",
  "WM/Work": "work",
  "WM/AuthorURL": "website",
  "WM/Picture": "picture"
};
class AsfTagMapper extends CommonTagMapper {
  static toRating(rating) {
    return {
      rating: Number.parseFloat(rating + 1) / 5
    };
  }
  constructor() {
    super(["asf"], asfTagMap);
  }
  postMap(tag) {
    switch (tag.id) {
      case "WM/SharedUserRating": {
        const keys = tag.id.split(":");
        tag.value = AsfTagMapper.toRating(tag.value);
        tag.id = keys[0];
        break;
      }
    }
  }
}
const id3v22TagMap = {
  TT2: "title",
  TP1: "artist",
  TP2: "albumartist",
  TAL: "album",
  TYE: "year",
  COM: "comment",
  TRK: "track",
  TPA: "disk",
  TCO: "genre",
  PIC: "picture",
  TCM: "composer",
  TOR: "originaldate",
  TOT: "originalalbum",
  TXT: "lyricist",
  TP3: "conductor",
  TPB: "label",
  TT1: "grouping",
  TT3: "subtitle",
  TLA: "language",
  TCR: "copyright",
  WCP: "license",
  TEN: "encodedby",
  TSS: "encodersettings",
  WAR: "website",
  PCS: "podcast",
  TCP: "compilation",
  TDR: "date",
  TS2: "albumartistsort",
  TSA: "albumsort",
  TSC: "composersort",
  TSP: "artistsort",
  TST: "titlesort",
  WFD: "podcasturl",
  TBP: "bpm"
};
class ID3v22TagMapper extends CaseInsensitiveTagMap {
  constructor() {
    super(["ID3v2.2"], id3v22TagMap);
  }
}
const apev2TagMap = {
  Title: "title",
  Artist: "artist",
  Artists: "artists",
  "Album Artist": "albumartist",
  Album: "album",
  Year: "date",
  Originalyear: "originalyear",
  Originaldate: "originaldate",
  Releasedate: "releasedate",
  Comment: "comment",
  Track: "track",
  Disc: "disk",
  DISCNUMBER: "disk",
  // ToDo: backwards compatibility', valid tag?
  Genre: "genre",
  "Cover Art (Front)": "picture",
  "Cover Art (Back)": "picture",
  Composer: "composer",
  Lyrics: "lyrics",
  ALBUMSORT: "albumsort",
  TITLESORT: "titlesort",
  WORK: "work",
  ARTISTSORT: "artistsort",
  ALBUMARTISTSORT: "albumartistsort",
  COMPOSERSORT: "composersort",
  Lyricist: "lyricist",
  Writer: "writer",
  Conductor: "conductor",
  // 'Performer=artist (instrument)': 'performer:instrument',
  MixArtist: "remixer",
  Arranger: "arranger",
  Engineer: "engineer",
  Producer: "producer",
  DJMixer: "djmixer",
  Mixer: "mixer",
  Label: "label",
  Grouping: "grouping",
  Subtitle: "subtitle",
  DiscSubtitle: "discsubtitle",
  Compilation: "compilation",
  BPM: "bpm",
  Mood: "mood",
  Media: "media",
  CatalogNumber: "catalognumber",
  MUSICBRAINZ_ALBUMSTATUS: "releasestatus",
  MUSICBRAINZ_ALBUMTYPE: "releasetype",
  RELEASECOUNTRY: "releasecountry",
  Script: "script",
  Language: "language",
  Copyright: "copyright",
  LICENSE: "license",
  EncodedBy: "encodedby",
  EncoderSettings: "encodersettings",
  Barcode: "barcode",
  ISRC: "isrc",
  ASIN: "asin",
  musicbrainz_trackid: "musicbrainz_recordingid",
  musicbrainz_releasetrackid: "musicbrainz_trackid",
  MUSICBRAINZ_ALBUMID: "musicbrainz_albumid",
  MUSICBRAINZ_ARTISTID: "musicbrainz_artistid",
  MUSICBRAINZ_ALBUMARTISTID: "musicbrainz_albumartistid",
  MUSICBRAINZ_RELEASEGROUPID: "musicbrainz_releasegroupid",
  MUSICBRAINZ_WORKID: "musicbrainz_workid",
  MUSICBRAINZ_TRMID: "musicbrainz_trmid",
  MUSICBRAINZ_DISCID: "musicbrainz_discid",
  Acoustid_Id: "acoustid_id",
  ACOUSTID_FINGERPRINT: "acoustid_fingerprint",
  MUSICIP_PUID: "musicip_puid",
  Weblink: "website",
  REPLAYGAIN_TRACK_GAIN: "replaygain_track_gain",
  REPLAYGAIN_TRACK_PEAK: "replaygain_track_peak",
  MP3GAIN_MINMAX: "replaygain_track_minmax",
  MP3GAIN_UNDO: "replaygain_undo"
};
class APEv2TagMapper extends CaseInsensitiveTagMap {
  constructor() {
    super(["APEv2"], apev2TagMap);
  }
}
const mp4TagMap = {
  "©nam": "title",
  "©ART": "artist",
  aART: "albumartist",
  /**
   * ToDo: Album artist seems to be stored here while Picard documentation says: aART
   */
  "----:com.apple.iTunes:Band": "albumartist",
  "©alb": "album",
  "©day": "date",
  "©cmt": "comment",
  "©com": "comment",
  trkn: "track",
  disk: "disk",
  "©gen": "genre",
  covr: "picture",
  "©wrt": "composer",
  "©lyr": "lyrics",
  soal: "albumsort",
  sonm: "titlesort",
  soar: "artistsort",
  soaa: "albumartistsort",
  soco: "composersort",
  "----:com.apple.iTunes:LYRICIST": "lyricist",
  "----:com.apple.iTunes:CONDUCTOR": "conductor",
  "----:com.apple.iTunes:REMIXER": "remixer",
  "----:com.apple.iTunes:ENGINEER": "engineer",
  "----:com.apple.iTunes:PRODUCER": "producer",
  "----:com.apple.iTunes:DJMIXER": "djmixer",
  "----:com.apple.iTunes:MIXER": "mixer",
  "----:com.apple.iTunes:LABEL": "label",
  "©grp": "grouping",
  "----:com.apple.iTunes:SUBTITLE": "subtitle",
  "----:com.apple.iTunes:DISCSUBTITLE": "discsubtitle",
  cpil: "compilation",
  tmpo: "bpm",
  "----:com.apple.iTunes:MOOD": "mood",
  "----:com.apple.iTunes:MEDIA": "media",
  "----:com.apple.iTunes:CATALOGNUMBER": "catalognumber",
  tvsh: "tvShow",
  tvsn: "tvSeason",
  tves: "tvEpisode",
  sosn: "tvShowSort",
  tven: "tvEpisodeId",
  tvnn: "tvNetwork",
  pcst: "podcast",
  purl: "podcasturl",
  "----:com.apple.iTunes:MusicBrainz Album Status": "releasestatus",
  "----:com.apple.iTunes:MusicBrainz Album Type": "releasetype",
  "----:com.apple.iTunes:MusicBrainz Album Release Country": "releasecountry",
  "----:com.apple.iTunes:SCRIPT": "script",
  "----:com.apple.iTunes:LANGUAGE": "language",
  cprt: "copyright",
  "©cpy": "copyright",
  "----:com.apple.iTunes:LICENSE": "license",
  "©too": "encodedby",
  pgap: "gapless",
  "----:com.apple.iTunes:BARCODE": "barcode",
  "----:com.apple.iTunes:ISRC": "isrc",
  "----:com.apple.iTunes:ASIN": "asin",
  "----:com.apple.iTunes:NOTES": "comment",
  "----:com.apple.iTunes:MusicBrainz Track Id": "musicbrainz_recordingid",
  "----:com.apple.iTunes:MusicBrainz Release Track Id": "musicbrainz_trackid",
  "----:com.apple.iTunes:MusicBrainz Album Id": "musicbrainz_albumid",
  "----:com.apple.iTunes:MusicBrainz Artist Id": "musicbrainz_artistid",
  "----:com.apple.iTunes:MusicBrainz Album Artist Id": "musicbrainz_albumartistid",
  "----:com.apple.iTunes:MusicBrainz Release Group Id": "musicbrainz_releasegroupid",
  "----:com.apple.iTunes:MusicBrainz Work Id": "musicbrainz_workid",
  "----:com.apple.iTunes:MusicBrainz TRM Id": "musicbrainz_trmid",
  "----:com.apple.iTunes:MusicBrainz Disc Id": "musicbrainz_discid",
  "----:com.apple.iTunes:Acoustid Id": "acoustid_id",
  "----:com.apple.iTunes:Acoustid Fingerprint": "acoustid_fingerprint",
  "----:com.apple.iTunes:MusicIP PUID": "musicip_puid",
  "----:com.apple.iTunes:fingerprint": "musicip_fingerprint",
  "----:com.apple.iTunes:replaygain_track_gain": "replaygain_track_gain",
  "----:com.apple.iTunes:replaygain_track_peak": "replaygain_track_peak",
  "----:com.apple.iTunes:replaygain_album_gain": "replaygain_album_gain",
  "----:com.apple.iTunes:replaygain_album_peak": "replaygain_album_peak",
  "----:com.apple.iTunes:replaygain_track_minmax": "replaygain_track_minmax",
  "----:com.apple.iTunes:replaygain_album_minmax": "replaygain_album_minmax",
  "----:com.apple.iTunes:replaygain_undo": "replaygain_undo",
  // Additional mappings:
  gnre: "genre",
  // ToDo: check mapping
  "----:com.apple.iTunes:ALBUMARTISTSORT": "albumartistsort",
  "----:com.apple.iTunes:ARTISTS": "artists",
  "----:com.apple.iTunes:ORIGINALDATE": "originaldate",
  "----:com.apple.iTunes:ORIGINALYEAR": "originalyear",
  "----:com.apple.iTunes:RELEASEDATE": "releasedate",
  // '----:com.apple.iTunes:PERFORMER': 'performer'
  desc: "description",
  ldes: "longDescription",
  "©mvn": "movement",
  "©mvi": "movementIndex",
  "©mvc": "movementTotal",
  "©wrk": "work",
  catg: "category",
  egid: "podcastId",
  hdvd: "hdVideo",
  keyw: "keywords",
  shwm: "showMovement",
  stik: "stik",
  rate: "rating"
};
const tagType = "iTunes";
class MP4TagMapper extends CaseInsensitiveTagMap {
  constructor() {
    super([tagType], mp4TagMap);
  }
  postMap(tag, warnings) {
    switch (tag.id) {
      case "rate":
        tag.value = {
          source: void 0,
          rating: Number.parseFloat(tag.value) / 100
        };
        break;
    }
  }
}
const vorbisTagMap = {
  TITLE: "title",
  ARTIST: "artist",
  ARTISTS: "artists",
  ALBUMARTIST: "albumartist",
  "ALBUM ARTIST": "albumartist",
  ALBUM: "album",
  DATE: "date",
  ORIGINALDATE: "originaldate",
  ORIGINALYEAR: "originalyear",
  RELEASEDATE: "releasedate",
  COMMENT: "comment",
  TRACKNUMBER: "track",
  DISCNUMBER: "disk",
  GENRE: "genre",
  METADATA_BLOCK_PICTURE: "picture",
  COMPOSER: "composer",
  LYRICS: "lyrics",
  ALBUMSORT: "albumsort",
  TITLESORT: "titlesort",
  WORK: "work",
  ARTISTSORT: "artistsort",
  ALBUMARTISTSORT: "albumartistsort",
  COMPOSERSORT: "composersort",
  LYRICIST: "lyricist",
  WRITER: "writer",
  CONDUCTOR: "conductor",
  // 'PERFORMER=artist (instrument)': 'performer:instrument', // ToDo
  REMIXER: "remixer",
  ARRANGER: "arranger",
  ENGINEER: "engineer",
  PRODUCER: "producer",
  DJMIXER: "djmixer",
  MIXER: "mixer",
  LABEL: "label",
  GROUPING: "grouping",
  SUBTITLE: "subtitle",
  DISCSUBTITLE: "discsubtitle",
  TRACKTOTAL: "totaltracks",
  DISCTOTAL: "totaldiscs",
  COMPILATION: "compilation",
  RATING: "rating",
  BPM: "bpm",
  KEY: "key",
  MOOD: "mood",
  MEDIA: "media",
  CATALOGNUMBER: "catalognumber",
  RELEASESTATUS: "releasestatus",
  RELEASETYPE: "releasetype",
  RELEASECOUNTRY: "releasecountry",
  SCRIPT: "script",
  LANGUAGE: "language",
  COPYRIGHT: "copyright",
  LICENSE: "license",
  ENCODEDBY: "encodedby",
  ENCODERSETTINGS: "encodersettings",
  BARCODE: "barcode",
  ISRC: "isrc",
  ASIN: "asin",
  MUSICBRAINZ_TRACKID: "musicbrainz_recordingid",
  MUSICBRAINZ_RELEASETRACKID: "musicbrainz_trackid",
  MUSICBRAINZ_ALBUMID: "musicbrainz_albumid",
  MUSICBRAINZ_ARTISTID: "musicbrainz_artistid",
  MUSICBRAINZ_ALBUMARTISTID: "musicbrainz_albumartistid",
  MUSICBRAINZ_RELEASEGROUPID: "musicbrainz_releasegroupid",
  MUSICBRAINZ_WORKID: "musicbrainz_workid",
  MUSICBRAINZ_TRMID: "musicbrainz_trmid",
  MUSICBRAINZ_DISCID: "musicbrainz_discid",
  ACOUSTID_ID: "acoustid_id",
  ACOUSTID_ID_FINGERPRINT: "acoustid_fingerprint",
  MUSICIP_PUID: "musicip_puid",
  // 'FINGERPRINT=MusicMagic Fingerprint {fingerprint}': 'musicip_fingerprint', // ToDo
  WEBSITE: "website",
  NOTES: "notes",
  TOTALTRACKS: "totaltracks",
  TOTALDISCS: "totaldiscs",
  // Discogs
  DISCOGS_ARTIST_ID: "discogs_artist_id",
  DISCOGS_ARTISTS: "artists",
  DISCOGS_ARTIST_NAME: "artists",
  DISCOGS_ALBUM_ARTISTS: "albumartist",
  DISCOGS_CATALOG: "catalognumber",
  DISCOGS_COUNTRY: "releasecountry",
  DISCOGS_DATE: "originaldate",
  DISCOGS_LABEL: "label",
  DISCOGS_LABEL_ID: "discogs_label_id",
  DISCOGS_MASTER_RELEASE_ID: "discogs_master_release_id",
  DISCOGS_RATING: "discogs_rating",
  DISCOGS_RELEASED: "date",
  DISCOGS_RELEASE_ID: "discogs_release_id",
  DISCOGS_VOTES: "discogs_votes",
  CATALOGID: "catalognumber",
  STYLE: "genre",
  //
  REPLAYGAIN_TRACK_GAIN: "replaygain_track_gain",
  REPLAYGAIN_TRACK_PEAK: "replaygain_track_peak",
  REPLAYGAIN_ALBUM_GAIN: "replaygain_album_gain",
  REPLAYGAIN_ALBUM_PEAK: "replaygain_album_peak",
  // To Sure if these (REPLAYGAIN_MINMAX, REPLAYGAIN_ALBUM_MINMAX & REPLAYGAIN_UNDO) are used for Vorbis:
  REPLAYGAIN_MINMAX: "replaygain_track_minmax",
  REPLAYGAIN_ALBUM_MINMAX: "replaygain_album_minmax",
  REPLAYGAIN_UNDO: "replaygain_undo"
};
class VorbisTagMapper extends CommonTagMapper {
  static toRating(email, rating, maxScore) {
    return {
      source: email ? email.toLowerCase() : void 0,
      rating: Number.parseFloat(rating) / maxScore * CommonTagMapper.maxRatingScore
    };
  }
  constructor() {
    super(["vorbis"], vorbisTagMap);
  }
  postMap(tag) {
    if (tag.id === "RATING") {
      tag.value = VorbisTagMapper.toRating(void 0, tag.value, 100);
    } else if (tag.id.indexOf("RATING:") === 0) {
      const keys = tag.id.split(":");
      tag.value = VorbisTagMapper.toRating(keys[1], tag.value, 1);
      tag.id = keys[0];
    }
  }
}
const riffInfoTagMap = {
  IART: "artist",
  // Artist
  ICRD: "date",
  // DateCreated
  INAM: "title",
  // Title
  TITL: "title",
  IPRD: "album",
  // Product
  ITRK: "track",
  IPRT: "track",
  // Additional tag for track index
  COMM: "comment",
  // Comments
  ICMT: "comment",
  // Country
  ICNT: "releasecountry",
  GNRE: "genre",
  // Genre
  IWRI: "writer",
  // WrittenBy
  RATE: "rating",
  YEAR: "year",
  ISFT: "encodedby",
  // Software
  CODE: "encodedby",
  // EncodedBy
  TURL: "website",
  // URL,
  IGNR: "genre",
  // Genre
  IENG: "engineer",
  // Engineer
  ITCH: "technician",
  // Technician
  IMED: "media",
  // Original Media
  IRPD: "album"
  // Product, where the file was intended for
};
class RiffInfoTagMapper extends CommonTagMapper {
  constructor() {
    super(["exif"], riffInfoTagMap);
  }
}
const ebmlTagMap = {
  "segment:title": "title",
  "album:ARTIST": "albumartist",
  "album:ARTISTSORT": "albumartistsort",
  "album:TITLE": "album",
  "album:DATE_RECORDED": "originaldate",
  "album:DATE_RELEASED": "releasedate",
  "album:PART_NUMBER": "disk",
  "album:TOTAL_PARTS": "totaltracks",
  "track:ARTIST": "artist",
  "track:ARTISTSORT": "artistsort",
  "track:TITLE": "title",
  "track:PART_NUMBER": "track",
  "track:MUSICBRAINZ_TRACKID": "musicbrainz_recordingid",
  "track:MUSICBRAINZ_ALBUMID": "musicbrainz_albumid",
  "track:MUSICBRAINZ_ARTISTID": "musicbrainz_artistid",
  "track:PUBLISHER": "label",
  "track:GENRE": "genre",
  "track:ENCODER": "encodedby",
  "track:ENCODER_OPTIONS": "encodersettings",
  "edition:TOTAL_PARTS": "totaldiscs",
  picture: "picture"
};
class MatroskaTagMapper extends CaseInsensitiveTagMap {
  constructor() {
    super(["matroska"], ebmlTagMap);
  }
}
const tagMap = {
  NAME: "title",
  AUTH: "artist",
  "(c) ": "copyright",
  ANNO: "comment"
};
class AiffTagMapper extends CommonTagMapper {
  constructor() {
    super(["AIFF"], tagMap);
  }
}
class CombinedTagMapper {
  constructor() {
    this.tagMappers = {};
    [
      new ID3v1TagMapper(),
      new ID3v22TagMapper(),
      new ID3v24TagMapper(),
      new MP4TagMapper(),
      new MP4TagMapper(),
      new VorbisTagMapper(),
      new APEv2TagMapper(),
      new AsfTagMapper(),
      new RiffInfoTagMapper(),
      new MatroskaTagMapper(),
      new AiffTagMapper()
    ].forEach((mapper) => {
      this.registerTagMapper(mapper);
    });
  }
  /**
   * Convert native to generic (common) tags
   * @param tagType Originating tag format
   * @param tag     Native tag to map to a generic tag id
   * @param warnings
   * @return Generic tag result (output of this function)
   */
  mapTag(tagType2, tag, warnings) {
    const tagMapper = this.tagMappers[tagType2];
    if (tagMapper) {
      return this.tagMappers[tagType2].mapGenericTag(tag, warnings);
    }
    throw new InternalParserError(`No generic tag mapper defined for tag-format: ${tagType2}`);
  }
  registerTagMapper(genericTagMapper) {
    for (const tagType2 of genericTagMapper.tagTypes) {
      this.tagMappers[tagType2] = genericTagMapper;
    }
  }
}
function parseLrc(lrcString) {
  const lines = lrcString.split("\n");
  const syncText = [];
  const timestampRegex = /\[(\d{2}):(\d{2})\.(\d{2})\]/;
  for (const line of lines) {
    const match = line.match(timestampRegex);
    if (match) {
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      const hundredths = Number.parseInt(match[3], 10);
      const timestamp = (minutes * 60 + seconds) * 1e3 + hundredths * 10;
      const text = line.replace(timestampRegex, "").trim();
      syncText.push({ timestamp, text });
    }
  }
  return {
    contentType: LyricsContentType.lyrics,
    timeStampFormat: TimestampFormat.milliseconds,
    syncText
  };
}
const debug$3 = initDebug("music-metadata:collector");
const TagPriority = ["matroska", "APEv2", "vorbis", "ID3v2.4", "ID3v2.3", "ID3v2.2", "exif", "asf", "iTunes", "AIFF", "ID3v1"];
class MetadataCollector {
  constructor(opts) {
    this.opts = opts;
    this.format = {
      tagTypes: [],
      trackInfo: []
    };
    this.native = {};
    this.common = {
      track: { no: null, of: null },
      disk: { no: null, of: null },
      movementIndex: { no: null, of: null }
    };
    this.quality = {
      warnings: []
    };
    this.commonOrigin = {};
    this.originPriority = {};
    this.tagMapper = new CombinedTagMapper();
    let priority = 1;
    for (const tagType2 of TagPriority) {
      this.originPriority[tagType2] = priority++;
    }
    this.originPriority.artificial = 500;
    this.originPriority.id3v1 = 600;
  }
  /**
   * @returns {boolean} true if one or more tags have been found
   */
  hasAny() {
    return Object.keys(this.native).length > 0;
  }
  addStreamInfo(streamInfo) {
    debug$3(`streamInfo: type=${streamInfo.type ? TrackType[streamInfo.type] : "?"}, codec=${streamInfo.codecName}`);
    this.format.trackInfo.push(streamInfo);
  }
  setFormat(key, value) {
    var _a;
    debug$3(`format: ${key} = ${value}`);
    this.format[key] = value;
    if ((_a = this.opts) == null ? void 0 : _a.observer) {
      this.opts.observer({ metadata: this, tag: { type: "format", id: key, value } });
    }
  }
  async addTag(tagType2, tagId, value) {
    debug$3(`tag ${tagType2}.${tagId} = ${value}`);
    if (!this.native[tagType2]) {
      this.format.tagTypes.push(tagType2);
      this.native[tagType2] = [];
    }
    this.native[tagType2].push({ id: tagId, value });
    await this.toCommon(tagType2, tagId, value);
  }
  addWarning(warning) {
    this.quality.warnings.push({ message: warning });
  }
  async postMap(tagType2, tag) {
    switch (tag.id) {
      case "artist":
        if (this.commonOrigin.artist === this.originPriority[tagType2]) {
          return this.postMap("artificial", { id: "artists", value: tag.value });
        }
        if (!this.common.artists) {
          this.setGenericTag("artificial", { id: "artists", value: tag.value });
        }
        break;
      case "artists":
        if (!this.common.artist || this.commonOrigin.artist === this.originPriority.artificial) {
          if (!this.common.artists || this.common.artists.indexOf(tag.value) === -1) {
            const artists = (this.common.artists || []).concat([tag.value]);
            const value = joinArtists(artists);
            const artistTag = { id: "artist", value };
            this.setGenericTag("artificial", artistTag);
          }
        }
        break;
      case "picture":
        return this.postFixPicture(tag.value).then((picture) => {
          if (picture !== null) {
            tag.value = picture;
            this.setGenericTag(tagType2, tag);
          }
        });
      case "totaltracks":
        this.common.track.of = CommonTagMapper.toIntOrNull(tag.value);
        return;
      case "totaldiscs":
        this.common.disk.of = CommonTagMapper.toIntOrNull(tag.value);
        return;
      case "movementTotal":
        this.common.movementIndex.of = CommonTagMapper.toIntOrNull(tag.value);
        return;
      case "track":
      case "disk":
      case "movementIndex": {
        const of = this.common[tag.id].of;
        this.common[tag.id] = CommonTagMapper.normalizeTrack(tag.value);
        this.common[tag.id].of = of != null ? of : this.common[tag.id].of;
        return;
      }
      case "bpm":
      case "year":
      case "originalyear":
        tag.value = Number.parseInt(tag.value, 10);
        break;
      case "date": {
        const year = Number.parseInt(tag.value.substr(0, 4), 10);
        if (!Number.isNaN(year)) {
          this.common.year = year;
        }
        break;
      }
      case "discogs_label_id":
      case "discogs_release_id":
      case "discogs_master_release_id":
      case "discogs_artist_id":
      case "discogs_votes":
        tag.value = typeof tag.value === "string" ? Number.parseInt(tag.value, 10) : tag.value;
        break;
      case "replaygain_track_gain":
      case "replaygain_track_peak":
      case "replaygain_album_gain":
      case "replaygain_album_peak":
        tag.value = toRatio(tag.value);
        break;
      case "replaygain_track_minmax":
        tag.value = tag.value.split(",").map((v) => Number.parseInt(v, 10));
        break;
      case "replaygain_undo": {
        const minMix = tag.value.split(",").map((v) => Number.parseInt(v, 10));
        tag.value = {
          leftChannel: minMix[0],
          rightChannel: minMix[1]
        };
        break;
      }
      case "gapless":
      case "compilation":
      case "podcast":
      case "showMovement":
        tag.value = tag.value === "1" || tag.value === 1;
        break;
      case "isrc": {
        const commonTag = this.common[tag.id];
        if (commonTag && commonTag.indexOf(tag.value) !== -1)
          return;
        break;
      }
      case "comment":
        if (typeof tag.value === "string") {
          tag.value = { text: tag.value };
        }
        if (tag.value.descriptor === "iTunPGAP") {
          this.setGenericTag(tagType2, { id: "gapless", value: tag.value.text === "1" });
        }
        break;
      case "lyrics":
        if (typeof tag.value === "string") {
          tag.value = parseLrc(tag.value);
        }
        break;
    }
    if (tag.value !== null) {
      this.setGenericTag(tagType2, tag);
    }
  }
  /**
   * Convert native tags to common tags
   * @returns {IAudioMetadata} Native + common tags
   */
  toCommonMetadata() {
    return {
      format: this.format,
      native: this.native,
      quality: this.quality,
      common: this.common
    };
  }
  /**
   * Fix some common issues with picture object
   * @param picture Picture
   */
  async postFixPicture(picture) {
    if (picture.data && picture.data.length > 0) {
      if (!picture.format) {
        const fileType = await fileTypeFromBuffer(Uint8Array.from(picture.data));
        if (fileType) {
          picture.format = fileType.mime;
        } else {
          return null;
        }
      }
      picture.format = picture.format.toLocaleLowerCase();
      switch (picture.format) {
        case "image/jpg":
          picture.format = "image/jpeg";
      }
      return picture;
    }
    this.addWarning("Empty picture tag found");
    return null;
  }
  /**
   * Convert native tag to common tags
   */
  async toCommon(tagType2, tagId, value) {
    const tag = { id: tagId, value };
    const genericTag = this.tagMapper.mapTag(tagType2, tag, this);
    if (genericTag) {
      await this.postMap(tagType2, genericTag);
    }
  }
  /**
   * Set generic tag
   */
  setGenericTag(tagType2, tag) {
    var _a;
    debug$3(`common.${tag.id} = ${tag.value}`);
    const prio0 = this.commonOrigin[tag.id] || 1e3;
    const prio1 = this.originPriority[tagType2];
    if (isSingleton(tag.id)) {
      if (prio1 <= prio0) {
        this.common[tag.id] = tag.value;
        this.commonOrigin[tag.id] = prio1;
      } else {
        return debug$3(`Ignore native tag (singleton): ${tagType2}.${tag.id} = ${tag.value}`);
      }
    } else {
      if (prio1 === prio0) {
        if (!isUnique(tag.id) || this.common[tag.id].indexOf(tag.value) === -1) {
          this.common[tag.id].push(tag.value);
        } else {
          debug$3(`Ignore duplicate value: ${tagType2}.${tag.id} = ${tag.value}`);
        }
      } else if (prio1 < prio0) {
        this.common[tag.id] = [tag.value];
        this.commonOrigin[tag.id] = prio1;
      } else {
        return debug$3(`Ignore native tag (list): ${tagType2}.${tag.id} = ${tag.value}`);
      }
    }
    if ((_a = this.opts) == null ? void 0 : _a.observer) {
      this.opts.observer({ metadata: this, tag: { type: "common", id: tag.id, value: tag.value } });
    }
  }
}
function joinArtists(artists) {
  if (artists.length > 2) {
    return `${artists.slice(0, artists.length - 1).join(", ")} & ${artists[artists.length - 1]}`;
  }
  return artists.join(" & ");
}
const mpegParserLoader = {
  parserType: "mpeg",
  extensions: [".mp2", ".mp3", ".m2a", ".aac", "aacp"],
  async load(metadata, tokenizer, options) {
    return new (await import("./MpegParser-BY-PigI6.js")).MpegParser(metadata, tokenizer, options);
  }
};
const apeParserLoader = {
  parserType: "apev2",
  extensions: [".ape"],
  async load(metadata, tokenizer, options) {
    return new (await Promise.resolve().then(() => APEv2Parser$1)).APEv2Parser(metadata, tokenizer, options);
  }
};
const asfParserLoader = {
  parserType: "asf",
  extensions: [".asf"],
  async load(metadata, tokenizer, options) {
    return new (await import("./AsfParser-CIJ0sBXY.js")).AsfParser(metadata, tokenizer, options);
  }
};
const dsdiffParserLoader = {
  parserType: "dsdiff",
  extensions: [".dff"],
  async load(metadata, tokenizer, options) {
    return new (await import("./DsdiffParser-BtHg_WYM.js")).DsdiffParser(metadata, tokenizer, options);
  }
};
const aiffParserLoader = {
  parserType: "aiff",
  extensions: [".aif", "aiff", "aifc"],
  async load(metadata, tokenizer, options) {
    return new (await import("./AiffParser-D0VTRsf3.js")).AIFFParser(metadata, tokenizer, options);
  }
};
const dsfParserLoader = {
  parserType: "dsf",
  extensions: [".dsf"],
  async load(metadata, tokenizer, options) {
    return new (await import("./DsfParser-Pfg5iLmW.js")).DsfParser(metadata, tokenizer, options);
  }
};
const flacParserLoader = {
  parserType: "flac",
  extensions: [".flac"],
  async load(metadata, tokenizer, options) {
    return new (await import("./FlacParser-BRRlHdbQ.js")).FlacParser(metadata, tokenizer, options);
  }
};
const matroskaParserLoader = {
  parserType: "matroska",
  extensions: [".mka", ".mkv", ".mk3d", ".mks", "webm"],
  async load(metadata, tokenizer, options) {
    return new (await import("./MatroskaParser-AlMLt4rZ.js")).MatroskaParser(metadata, tokenizer, options);
  }
};
const mp4ParserLoader = {
  parserType: "mp4",
  extensions: [".mp4", ".m4a", ".m4b", ".m4pa", "m4v", "m4r", "3gp"],
  async load(metadata, tokenizer, options) {
    return new (await import("./MP4Parser-C0jU0-pr.js")).MP4Parser(metadata, tokenizer, options);
  }
};
const musepackParserLoader = {
  parserType: "musepack",
  extensions: [".mpc"],
  async load(metadata, tokenizer, options) {
    return new (await import("./MusepackParser-DMg1kCjw.js")).MusepackParser(metadata, tokenizer, options);
  }
};
const oggParserLoader = {
  parserType: "ogg",
  extensions: [".ogg", ".ogv", ".oga", ".ogm", ".ogx", ".opus", ".spx"],
  async load(metadata, tokenizer, options) {
    return new (await import("./OggParser-6gb7AeJW.js")).OggParser(metadata, tokenizer, options);
  }
};
const wavpackParserLoader = {
  parserType: "wavpack",
  extensions: [".wv", ".wvp"],
  async load(metadata, tokenizer, options) {
    return new (await import("./WavPackParser-FKkLcYbi.js")).WavPackParser(metadata, tokenizer, options);
  }
};
const riffParserLoader = {
  parserType: "riff",
  extensions: [".wav", "wave", ".bwf"],
  async load(metadata, tokenizer, options) {
    return new (await import("./WaveParser-B9wMEcvd.js")).WaveParser(metadata, tokenizer, options);
  }
};
const amrParserLoader = {
  parserType: "amr",
  extensions: [".amr"],
  async load(metadata, tokenizer, options) {
    return new (await import("./AmrParser-BHtDHVOQ.js")).AmrParser(metadata, tokenizer, options);
  }
};
const debug$2 = initDebug("music-metadata:parser:factory");
function parseHttpContentType(contentType$1) {
  const type = contentType.parse(contentType$1);
  const mime = parse_1$1(type.type);
  return {
    type: mime.type,
    subtype: mime.subtype,
    suffix: mime.suffix,
    parameters: type.parameters
  };
}
class ParserFactory {
  constructor() {
    this.parsers = [];
    [
      flacParserLoader,
      mpegParserLoader,
      apeParserLoader,
      mp4ParserLoader,
      matroskaParserLoader,
      riffParserLoader,
      oggParserLoader,
      asfParserLoader,
      aiffParserLoader,
      wavpackParserLoader,
      musepackParserLoader,
      dsfParserLoader,
      dsdiffParserLoader,
      amrParserLoader
    ].forEach((parser) => this.registerParser(parser));
  }
  registerParser(parser) {
    this.parsers.push(parser);
  }
  async parse(tokenizer, parserLoader, opts) {
    if (!parserLoader) {
      const buf = new Uint8Array(4100);
      if (tokenizer.fileInfo.mimeType) {
        parserLoader = this.findLoaderForType(getParserIdForMimeType(tokenizer.fileInfo.mimeType));
      }
      if (!parserLoader && tokenizer.fileInfo.path) {
        parserLoader = this.findLoaderForExtension(tokenizer.fileInfo.path);
      }
      if (!parserLoader) {
        debug$2("Guess parser on content...");
        await tokenizer.peekBuffer(buf, { mayBeLess: true });
        const guessedType = await fileTypeFromBuffer(buf);
        if (!guessedType || !guessedType.mime) {
          throw new CouldNotDetermineFileTypeError("Failed to determine audio format");
        }
        debug$2(`Guessed file type is mime=${guessedType.mime}, extension=${guessedType.ext}`);
        parserLoader = this.findLoaderForType(getParserIdForMimeType(guessedType.mime));
        if (!parserLoader) {
          throw new UnsupportedFileTypeError(`Guessed MIME-type not supported: ${guessedType.mime}`);
        }
      }
    }
    debug$2(`Loading ${parserLoader.parserType} parser...`);
    const metadata = new MetadataCollector(opts);
    const parser = await parserLoader.load(metadata, tokenizer, opts ?? {});
    debug$2(`Parser ${parserLoader.parserType} loaded`);
    await parser.parse();
    return metadata.toCommonMetadata();
  }
  /**
   * @param filePath - Path, filename or extension to audio file
   * @return Parser submodule name
   */
  findLoaderForExtension(filePath) {
    if (!filePath)
      return;
    const extension = getExtension(filePath).toLocaleLowerCase() || filePath;
    return this.parsers.find((parser) => parser.extensions.indexOf(extension) !== -1);
  }
  findLoaderForType(moduleName) {
    return moduleName ? this.parsers.find((parser) => parser.parserType === moduleName) : void 0;
  }
}
function getExtension(fname) {
  const i = fname.lastIndexOf(".");
  return i === -1 ? "" : fname.slice(i);
}
function getParserIdForMimeType(httpContentType) {
  let mime;
  if (!httpContentType)
    return;
  try {
    mime = parseHttpContentType(httpContentType);
  } catch (err2) {
    debug$2(`Invalid HTTP Content-Type header value: ${httpContentType}`);
    return;
  }
  const subType = mime.subtype.indexOf("x-") === 0 ? mime.subtype.substring(2) : mime.subtype;
  switch (mime.type) {
    case "audio":
      switch (subType) {
        case "mp3":
        case "mpeg":
          return "mpeg";
        case "aac":
        case "aacp":
          return "mpeg";
        case "flac":
          return "flac";
        case "ape":
        case "monkeys-audio":
          return "apev2";
        case "mp4":
        case "m4a":
          return "mp4";
        case "ogg":
        case "opus":
        case "speex":
          return "ogg";
        case "ms-wma":
        case "ms-wmv":
        case "ms-asf":
          return "asf";
        case "aiff":
        case "aif":
        case "aifc":
          return "aiff";
        case "vnd.wave":
        case "wav":
        case "wave":
          return "riff";
        case "wavpack":
          return "wavpack";
        case "musepack":
          return "musepack";
        case "matroska":
        case "webm":
          return "matroska";
        case "dsf":
          return "dsf";
        case "amr":
          return "amr";
      }
      break;
    case "video":
      switch (subType) {
        case "ms-asf":
        case "ms-wmv":
          return "asf";
        case "m4v":
        case "mp4":
          return "mp4";
        case "ogg":
          return "ogg";
        case "matroska":
        case "webm":
          return "matroska";
      }
      break;
    case "application":
      switch (subType) {
        case "vnd.ms-asf":
          return "asf";
        case "ogg":
          return "ogg";
      }
      break;
  }
}
class BasicParser {
  /**
   * Initialize parser with output (metadata), input (tokenizer) & parsing options (options).
   * @param {INativeMetadataCollector} metadata Output
   * @param {ITokenizer} tokenizer Input
   * @param {IOptions} options Parsing options
   */
  constructor(metadata, tokenizer, options) {
    this.metadata = metadata;
    this.tokenizer = tokenizer;
    this.options = options;
  }
}
const validFourCC = /^[\x21-\x7e©][\x20-\x7e\x00()]{3}/;
const FourCcToken = {
  len: 4,
  get: (buf, off) => {
    const id = uint8ArrayToString(buf.slice(off, off + FourCcToken.len), "latin1");
    if (!id.match(validFourCC)) {
      throw new FieldDecodingError(`FourCC contains invalid characters: ${a2hex(id)} "${id}"`);
    }
    return id;
  },
  put: (buffer, offset, id) => {
    const str = stringToUint8Array(id);
    if (str.length !== 4)
      throw new InternalParserError("Invalid length");
    buffer.set(str, offset);
    return offset + 4;
  }
};
var DataType;
(function(DataType2) {
  DataType2[DataType2["text_utf8"] = 0] = "text_utf8";
  DataType2[DataType2["binary"] = 1] = "binary";
  DataType2[DataType2["external_info"] = 2] = "external_info";
  DataType2[DataType2["reserved"] = 3] = "reserved";
})(DataType || (DataType = {}));
const DescriptorParser = {
  len: 52,
  get: (buf, off) => {
    return {
      // should equal 'MAC '
      ID: FourCcToken.get(buf, off),
      // versionIndex number * 1000 (3.81 = 3810) (remember that 4-byte alignment causes this to take 4-bytes)
      version: UINT32_LE.get(buf, off + 4) / 1e3,
      // the number of descriptor bytes (allows later expansion of this header)
      descriptorBytes: UINT32_LE.get(buf, off + 8),
      // the number of header APE_HEADER bytes
      headerBytes: UINT32_LE.get(buf, off + 12),
      // the number of header APE_HEADER bytes
      seekTableBytes: UINT32_LE.get(buf, off + 16),
      // the number of header data bytes (from original file)
      headerDataBytes: UINT32_LE.get(buf, off + 20),
      // the number of bytes of APE frame data
      apeFrameDataBytes: UINT32_LE.get(buf, off + 24),
      // the high order number of APE frame data bytes
      apeFrameDataBytesHigh: UINT32_LE.get(buf, off + 28),
      // the terminating data of the file (not including tag data)
      terminatingDataBytes: UINT32_LE.get(buf, off + 32),
      // the MD5 hash of the file (see notes for usage... it's a little tricky)
      fileMD5: new Uint8ArrayType(16).get(buf, off + 36)
    };
  }
};
const Header = {
  len: 24,
  get: (buf, off) => {
    return {
      // the compression level (see defines I.E. COMPRESSION_LEVEL_FAST)
      compressionLevel: UINT16_LE.get(buf, off),
      // any format flags (for future use)
      formatFlags: UINT16_LE.get(buf, off + 2),
      // the number of audio blocks in one frame
      blocksPerFrame: UINT32_LE.get(buf, off + 4),
      // the number of audio blocks in the final frame
      finalFrameBlocks: UINT32_LE.get(buf, off + 8),
      // the total number of frames
      totalFrames: UINT32_LE.get(buf, off + 12),
      // the bits per sample (typically 16)
      bitsPerSample: UINT16_LE.get(buf, off + 16),
      // the number of channels (1 or 2)
      channel: UINT16_LE.get(buf, off + 18),
      // the sample rate (typically 44100)
      sampleRate: UINT32_LE.get(buf, off + 20)
    };
  }
};
const TagFooter = {
  len: 32,
  get: (buf, off) => {
    return {
      // should equal 'APETAGEX'
      ID: new StringType(8, "ascii").get(buf, off),
      // equals CURRENT_APE_TAG_VERSION
      version: UINT32_LE.get(buf, off + 8),
      // the complete size of the tag, including this footer (excludes header)
      size: UINT32_LE.get(buf, off + 12),
      // the number of fields in the tag
      fields: UINT32_LE.get(buf, off + 16),
      // reserved for later use (must be zero),
      flags: parseTagFlags(UINT32_LE.get(buf, off + 20))
    };
  }
};
const TagItemHeader = {
  len: 8,
  get: (buf, off) => {
    return {
      // Length of assigned value in bytes
      size: UINT32_LE.get(buf, off),
      // reserved for later use (must be zero),
      flags: parseTagFlags(UINT32_LE.get(buf, off + 4))
    };
  }
};
function parseTagFlags(flags) {
  return {
    containsHeader: isBitSet(flags, 31),
    containsFooter: isBitSet(flags, 30),
    isHeader: isBitSet(flags, 29),
    readOnly: isBitSet(flags, 0),
    dataType: (flags & 6) >> 1
  };
}
function isBitSet(num, bit) {
  return (num & 1 << bit) !== 0;
}
const debug$1 = initDebug("music-metadata:parser:APEv2");
const tagFormat = "APEv2";
const preamble = "APETAGEX";
class ApeContentError extends makeUnexpectedFileContentError("APEv2") {
}
class APEv2Parser extends BasicParser {
  constructor() {
    super(...arguments);
    this.ape = {};
  }
  static tryParseApeHeader(metadata, tokenizer, options) {
    const apeParser = new APEv2Parser(metadata, tokenizer, options);
    return apeParser.tryParseApeHeader();
  }
  /**
   * Calculate the media file duration
   * @param ah ApeHeader
   * @return {number} duration in seconds
   */
  static calculateDuration(ah) {
    let duration = ah.totalFrames > 1 ? ah.blocksPerFrame * (ah.totalFrames - 1) : 0;
    duration += ah.finalFrameBlocks;
    return duration / ah.sampleRate;
  }
  /**
   * Calculates the APEv1 / APEv2 first field offset
   * @param reader
   * @param offset
   */
  static async findApeFooterOffset(reader, offset) {
    const apeBuf = new Uint8Array(TagFooter.len);
    await reader.randomRead(apeBuf, 0, TagFooter.len, offset - TagFooter.len);
    const tagFooter = TagFooter.get(apeBuf, 0);
    if (tagFooter.ID === "APETAGEX") {
      if (tagFooter.flags.isHeader) {
        debug$1(`APE Header found at offset=${offset - TagFooter.len}`);
      } else {
        debug$1(`APE Footer found at offset=${offset - TagFooter.len}`);
        offset -= tagFooter.size;
      }
      return { footer: tagFooter, offset };
    }
  }
  static parseTagFooter(metadata, buffer, options) {
    const footer = TagFooter.get(buffer, buffer.length - TagFooter.len);
    if (footer.ID !== preamble)
      throw new ApeContentError("Unexpected APEv2 Footer ID preamble value");
    fromBuffer(buffer);
    const apeParser = new APEv2Parser(metadata, fromBuffer(buffer), options);
    return apeParser.parseTags(footer);
  }
  /**
   * Parse APEv1 / APEv2 header if header signature found
   */
  async tryParseApeHeader() {
    if (this.tokenizer.fileInfo.size && this.tokenizer.fileInfo.size - this.tokenizer.position < TagFooter.len) {
      debug$1("No APEv2 header found, end-of-file reached");
      return;
    }
    const footer = await this.tokenizer.peekToken(TagFooter);
    if (footer.ID === preamble) {
      await this.tokenizer.ignore(TagFooter.len);
      return this.parseTags(footer);
    }
    debug$1(`APEv2 header not found at offset=${this.tokenizer.position}`);
    if (this.tokenizer.fileInfo.size) {
      const remaining = this.tokenizer.fileInfo.size - this.tokenizer.position;
      const buffer = new Uint8Array(remaining);
      await this.tokenizer.readBuffer(buffer);
      return APEv2Parser.parseTagFooter(this.metadata, buffer, this.options);
    }
  }
  async parse() {
    const descriptor = await this.tokenizer.readToken(DescriptorParser);
    if (descriptor.ID !== "MAC ")
      throw new ApeContentError("Unexpected descriptor ID");
    this.ape.descriptor = descriptor;
    const lenExp = descriptor.descriptorBytes - DescriptorParser.len;
    const header = await (lenExp > 0 ? this.parseDescriptorExpansion(lenExp) : this.parseHeader());
    await this.tokenizer.ignore(header.forwardBytes);
    return this.tryParseApeHeader();
  }
  async parseTags(footer) {
    const keyBuffer = new Uint8Array(256);
    let bytesRemaining = footer.size - TagFooter.len;
    debug$1(`Parse APE tags at offset=${this.tokenizer.position}, size=${bytesRemaining}`);
    for (let i = 0; i < footer.fields; i++) {
      if (bytesRemaining < TagItemHeader.len) {
        this.metadata.addWarning(`APEv2 Tag-header: ${footer.fields - i} items remaining, but no more tag data to read.`);
        break;
      }
      const tagItemHeader = await this.tokenizer.readToken(TagItemHeader);
      bytesRemaining -= TagItemHeader.len + tagItemHeader.size;
      await this.tokenizer.peekBuffer(keyBuffer, { length: Math.min(keyBuffer.length, bytesRemaining) });
      let zero = findZero(keyBuffer, 0, keyBuffer.length);
      const key = await this.tokenizer.readToken(new StringType(zero, "ascii"));
      await this.tokenizer.ignore(1);
      bytesRemaining -= key.length + 1;
      switch (tagItemHeader.flags.dataType) {
        case DataType.text_utf8: {
          const value = await this.tokenizer.readToken(new StringType(tagItemHeader.size, "utf8"));
          const values = value.split(/\x00/g);
          await Promise.all(values.map((val) => this.metadata.addTag(tagFormat, key, val)));
          break;
        }
        case DataType.binary:
          if (this.options.skipCovers) {
            await this.tokenizer.ignore(tagItemHeader.size);
          } else {
            const picData = new Uint8Array(tagItemHeader.size);
            await this.tokenizer.readBuffer(picData);
            zero = findZero(picData, 0, picData.length);
            const description2 = uint8ArrayToString(picData.slice(0, zero));
            const data = picData.slice(zero + 1);
            await this.metadata.addTag(tagFormat, key, {
              description: description2,
              data
            });
          }
          break;
        case DataType.external_info:
          debug$1(`Ignore external info ${key}`);
          await this.tokenizer.ignore(tagItemHeader.size);
          break;
        case DataType.reserved:
          debug$1(`Ignore external info ${key}`);
          this.metadata.addWarning(`APEv2 header declares a reserved datatype for "${key}"`);
          await this.tokenizer.ignore(tagItemHeader.size);
          break;
      }
    }
  }
  async parseDescriptorExpansion(lenExp) {
    await this.tokenizer.ignore(lenExp);
    return this.parseHeader();
  }
  async parseHeader() {
    const header = await this.tokenizer.readToken(Header);
    this.metadata.setFormat("lossless", true);
    this.metadata.setFormat("container", "Monkey's Audio");
    this.metadata.setFormat("bitsPerSample", header.bitsPerSample);
    this.metadata.setFormat("sampleRate", header.sampleRate);
    this.metadata.setFormat("numberOfChannels", header.channel);
    this.metadata.setFormat("duration", APEv2Parser.calculateDuration(header));
    if (!this.ape.descriptor) {
      throw new ApeContentError("Missing APE descriptor");
    }
    return {
      forwardBytes: this.ape.descriptor.seekTableBytes + this.ape.descriptor.headerDataBytes + this.ape.descriptor.apeFrameDataBytes + this.ape.descriptor.terminatingDataBytes
    };
  }
}
const APEv2Parser$1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  APEv2Parser,
  ApeContentError
}, Symbol.toStringTag, { value: "Module" }));
const debug = initDebug("music-metadata:parser:ID3v1");
const Genres = [
  "Blues",
  "Classic Rock",
  "Country",
  "Dance",
  "Disco",
  "Funk",
  "Grunge",
  "Hip-Hop",
  "Jazz",
  "Metal",
  "New Age",
  "Oldies",
  "Other",
  "Pop",
  "R&B",
  "Rap",
  "Reggae",
  "Rock",
  "Techno",
  "Industrial",
  "Alternative",
  "Ska",
  "Death Metal",
  "Pranks",
  "Soundtrack",
  "Euro-Techno",
  "Ambient",
  "Trip-Hop",
  "Vocal",
  "Jazz+Funk",
  "Fusion",
  "Trance",
  "Classical",
  "Instrumental",
  "Acid",
  "House",
  "Game",
  "Sound Clip",
  "Gospel",
  "Noise",
  "Alt. Rock",
  "Bass",
  "Soul",
  "Punk",
  "Space",
  "Meditative",
  "Instrumental Pop",
  "Instrumental Rock",
  "Ethnic",
  "Gothic",
  "Darkwave",
  "Techno-Industrial",
  "Electronic",
  "Pop-Folk",
  "Eurodance",
  "Dream",
  "Southern Rock",
  "Comedy",
  "Cult",
  "Gangsta Rap",
  "Top 40",
  "Christian Rap",
  "Pop/Funk",
  "Jungle",
  "Native American",
  "Cabaret",
  "New Wave",
  "Psychedelic",
  "Rave",
  "Showtunes",
  "Trailer",
  "Lo-Fi",
  "Tribal",
  "Acid Punk",
  "Acid Jazz",
  "Polka",
  "Retro",
  "Musical",
  "Rock & Roll",
  "Hard Rock",
  "Folk",
  "Folk/Rock",
  "National Folk",
  "Swing",
  "Fast-Fusion",
  "Bebob",
  "Latin",
  "Revival",
  "Celtic",
  "Bluegrass",
  "Avantgarde",
  "Gothic Rock",
  "Progressive Rock",
  "Psychedelic Rock",
  "Symphonic Rock",
  "Slow Rock",
  "Big Band",
  "Chorus",
  "Easy Listening",
  "Acoustic",
  "Humour",
  "Speech",
  "Chanson",
  "Opera",
  "Chamber Music",
  "Sonata",
  "Symphony",
  "Booty Bass",
  "Primus",
  "Porn Groove",
  "Satire",
  "Slow Jam",
  "Club",
  "Tango",
  "Samba",
  "Folklore",
  "Ballad",
  "Power Ballad",
  "Rhythmic Soul",
  "Freestyle",
  "Duet",
  "Punk Rock",
  "Drum Solo",
  "A Cappella",
  "Euro-House",
  "Dance Hall",
  "Goa",
  "Drum & Bass",
  "Club-House",
  "Hardcore",
  "Terror",
  "Indie",
  "BritPop",
  "Negerpunk",
  "Polsk Punk",
  "Beat",
  "Christian Gangsta Rap",
  "Heavy Metal",
  "Black Metal",
  "Crossover",
  "Contemporary Christian",
  "Christian Rock",
  "Merengue",
  "Salsa",
  "Thrash Metal",
  "Anime",
  "JPop",
  "Synthpop",
  "Abstract",
  "Art Rock",
  "Baroque",
  "Bhangra",
  "Big Beat",
  "Breakbeat",
  "Chillout",
  "Downtempo",
  "Dub",
  "EBM",
  "Eclectic",
  "Electro",
  "Electroclash",
  "Emo",
  "Experimental",
  "Garage",
  "Global",
  "IDM",
  "Illbient",
  "Industro-Goth",
  "Jam Band",
  "Krautrock",
  "Leftfield",
  "Lounge",
  "Math Rock",
  "New Romantic",
  "Nu-Breakz",
  "Post-Punk",
  "Post-Rock",
  "Psytrance",
  "Shoegaze",
  "Space Rock",
  "Trop Rock",
  "World Music",
  "Neoclassical",
  "Audiobook",
  "Audio Theatre",
  "Neue Deutsche Welle",
  "Podcast",
  "Indie Rock",
  "G-Funk",
  "Dubstep",
  "Garage Rock",
  "Psybient"
];
const Iid3v1Token = {
  len: 128,
  /**
   * @param buf Buffer possibly holding the 128 bytes ID3v1.1 metadata header
   * @param off Offset in buffer in bytes
   * @returns ID3v1.1 header if first 3 bytes equals 'TAG', otherwise null is returned
   */
  get: (buf, off) => {
    const header = new Id3v1StringType(3).get(buf, off);
    return header === "TAG" ? {
      header,
      title: new Id3v1StringType(30).get(buf, off + 3),
      artist: new Id3v1StringType(30).get(buf, off + 33),
      album: new Id3v1StringType(30).get(buf, off + 63),
      year: new Id3v1StringType(4).get(buf, off + 93),
      comment: new Id3v1StringType(28).get(buf, off + 97),
      // ID3v1.1 separator for track
      zeroByte: UINT8.get(buf, off + 127),
      // track: ID3v1.1 field added by Michael Mutschler
      track: UINT8.get(buf, off + 126),
      genre: UINT8.get(buf, off + 127)
    } : null;
  }
};
class Id3v1StringType {
  constructor(len) {
    this.len = len;
    this.stringType = new StringType(len, "latin1");
  }
  get(buf, off) {
    let value = this.stringType.get(buf, off);
    value = trimRightNull(value);
    value = value.trim();
    return value.length > 0 ? value : void 0;
  }
}
class ID3v1Parser extends BasicParser {
  constructor(metadata, tokenizer, options) {
    super(metadata, tokenizer, options);
    this.apeHeader = options.apeHeader;
  }
  static getGenre(genreIndex) {
    if (genreIndex < Genres.length) {
      return Genres[genreIndex];
    }
    return void 0;
  }
  async parse() {
    if (!this.tokenizer.fileInfo.size) {
      debug("Skip checking for ID3v1 because the file-size is unknown");
      return;
    }
    if (this.apeHeader) {
      this.tokenizer.ignore(this.apeHeader.offset - this.tokenizer.position);
      const apeParser = new APEv2Parser(this.metadata, this.tokenizer, this.options);
      await apeParser.parseTags(this.apeHeader.footer);
    }
    const offset = this.tokenizer.fileInfo.size - Iid3v1Token.len;
    if (this.tokenizer.position > offset) {
      debug("Already consumed the last 128 bytes");
      return;
    }
    const header = await this.tokenizer.readToken(Iid3v1Token, offset);
    if (header) {
      debug("ID3v1 header found at: pos=%s", this.tokenizer.fileInfo.size - Iid3v1Token.len);
      const props = ["title", "artist", "album", "comment", "track", "year"];
      for (const id of props) {
        if (header[id] && header[id] !== "")
          await this.addTag(id, header[id]);
      }
      const genre = ID3v1Parser.getGenre(header.genre);
      if (genre)
        await this.addTag("genre", genre);
    } else {
      debug("ID3v1 header not found at: pos=%s", this.tokenizer.fileInfo.size - Iid3v1Token.len);
    }
  }
  async addTag(id, value) {
    await this.metadata.addTag("ID3v1", id, value);
  }
}
function parseWebStream(webStream, fileInfo, options = {}) {
  return parseFromTokenizer(fromWebStream(webStream, { fileInfo: typeof fileInfo === "string" ? { mimeType: fileInfo } : fileInfo }), options);
}
function parseFromTokenizer(tokenizer, options) {
  const parserFactory = new ParserFactory();
  return parserFactory.parse(tokenizer, void 0, options);
}
initDebug("music-metadata:parser");
class SongMetadata {
  constructor() {
    __publicField(this, "title");
    __publicField(this, "album");
    __publicField(this, "frontCover");
    __publicField(this, "year");
    __publicField(this, "artist");
    __publicField(this, "albumArtist");
    __publicField(this, "genre");
    __publicField(this, "duration");
    __publicField(this, "itemType");
    __publicField(this, "format");
  }
}
var pino$2 = { exports: {} };
const isErrorLike$2 = (err2) => {
  return err2 && typeof err2.message === "string";
};
const getErrorCause = (err2) => {
  if (!err2) return;
  const cause = err2.cause;
  if (typeof cause === "function") {
    const causeResult = err2.cause();
    return isErrorLike$2(causeResult) ? causeResult : void 0;
  } else {
    return isErrorLike$2(cause) ? cause : void 0;
  }
};
const _stackWithCauses = (err2, seen2) => {
  if (!isErrorLike$2(err2)) return "";
  const stack = err2.stack || "";
  if (seen2.has(err2)) {
    return stack + "\ncauses have become circular...";
  }
  const cause = getErrorCause(err2);
  if (cause) {
    seen2.add(err2);
    return stack + "\ncaused by: " + _stackWithCauses(cause, seen2);
  } else {
    return stack;
  }
};
const stackWithCauses$1 = (err2) => _stackWithCauses(err2, /* @__PURE__ */ new Set());
const _messageWithCauses = (err2, seen2, skip) => {
  if (!isErrorLike$2(err2)) return "";
  const message = skip ? "" : err2.message || "";
  if (seen2.has(err2)) {
    return message + ": ...";
  }
  const cause = getErrorCause(err2);
  if (cause) {
    seen2.add(err2);
    const skipIfVErrorStyleCause = typeof err2.cause === "function";
    return message + (skipIfVErrorStyleCause ? "" : ": ") + _messageWithCauses(cause, seen2, skipIfVErrorStyleCause);
  } else {
    return message;
  }
};
const messageWithCauses$1 = (err2) => _messageWithCauses(err2, /* @__PURE__ */ new Set());
var errHelpers = {
  isErrorLike: isErrorLike$2,
  getErrorCause,
  stackWithCauses: stackWithCauses$1,
  messageWithCauses: messageWithCauses$1
};
const seen$2 = Symbol("circular-ref-tag");
const rawSymbol$2 = Symbol("pino-raw-err-ref");
const pinoErrProto$2 = Object.create({}, {
  type: {
    enumerable: true,
    writable: true,
    value: void 0
  },
  message: {
    enumerable: true,
    writable: true,
    value: void 0
  },
  stack: {
    enumerable: true,
    writable: true,
    value: void 0
  },
  aggregateErrors: {
    enumerable: true,
    writable: true,
    value: void 0
  },
  raw: {
    enumerable: false,
    get: function() {
      return this[rawSymbol$2];
    },
    set: function(val) {
      this[rawSymbol$2] = val;
    }
  }
});
Object.defineProperty(pinoErrProto$2, rawSymbol$2, {
  writable: true,
  value: {}
});
var errProto = {
  pinoErrProto: pinoErrProto$2,
  pinoErrorSymbols: {
    seen: seen$2,
    rawSymbol: rawSymbol$2
  }
};
var err = errSerializer$1;
const { messageWithCauses, stackWithCauses, isErrorLike: isErrorLike$1 } = errHelpers;
const { pinoErrProto: pinoErrProto$1, pinoErrorSymbols: pinoErrorSymbols$1 } = errProto;
const { seen: seen$1 } = pinoErrorSymbols$1;
const { toString: toString$1 } = Object.prototype;
function errSerializer$1(err2) {
  if (!isErrorLike$1(err2)) {
    return err2;
  }
  err2[seen$1] = void 0;
  const _err = Object.create(pinoErrProto$1);
  _err.type = toString$1.call(err2.constructor) === "[object Function]" ? err2.constructor.name : err2.name;
  _err.message = messageWithCauses(err2);
  _err.stack = stackWithCauses(err2);
  if (Array.isArray(err2.errors)) {
    _err.aggregateErrors = err2.errors.map((err3) => errSerializer$1(err3));
  }
  for (const key in err2) {
    if (_err[key] === void 0) {
      const val = err2[key];
      if (isErrorLike$1(val)) {
        if (key !== "cause" && !Object.prototype.hasOwnProperty.call(val, seen$1)) {
          _err[key] = errSerializer$1(val);
        }
      } else {
        _err[key] = val;
      }
    }
  }
  delete err2[seen$1];
  _err.raw = err2;
  return _err;
}
var errWithCause = errWithCauseSerializer$1;
const { isErrorLike } = errHelpers;
const { pinoErrProto, pinoErrorSymbols } = errProto;
const { seen } = pinoErrorSymbols;
const { toString } = Object.prototype;
function errWithCauseSerializer$1(err2) {
  if (!isErrorLike(err2)) {
    return err2;
  }
  err2[seen] = void 0;
  const _err = Object.create(pinoErrProto);
  _err.type = toString.call(err2.constructor) === "[object Function]" ? err2.constructor.name : err2.name;
  _err.message = err2.message;
  _err.stack = err2.stack;
  if (Array.isArray(err2.errors)) {
    _err.aggregateErrors = err2.errors.map((err3) => errWithCauseSerializer$1(err3));
  }
  if (isErrorLike(err2.cause) && !Object.prototype.hasOwnProperty.call(err2.cause, seen)) {
    _err.cause = errWithCauseSerializer$1(err2.cause);
  }
  for (const key in err2) {
    if (_err[key] === void 0) {
      const val = err2[key];
      if (isErrorLike(val)) {
        if (!Object.prototype.hasOwnProperty.call(val, seen)) {
          _err[key] = errWithCauseSerializer$1(val);
        }
      } else {
        _err[key] = val;
      }
    }
  }
  delete err2[seen];
  _err.raw = err2;
  return _err;
}
var req = {
  mapHttpRequest: mapHttpRequest$1,
  reqSerializer
};
const rawSymbol$1 = Symbol("pino-raw-req-ref");
const pinoReqProto = Object.create({}, {
  id: {
    enumerable: true,
    writable: true,
    value: ""
  },
  method: {
    enumerable: true,
    writable: true,
    value: ""
  },
  url: {
    enumerable: true,
    writable: true,
    value: ""
  },
  query: {
    enumerable: true,
    writable: true,
    value: ""
  },
  params: {
    enumerable: true,
    writable: true,
    value: ""
  },
  headers: {
    enumerable: true,
    writable: true,
    value: {}
  },
  remoteAddress: {
    enumerable: true,
    writable: true,
    value: ""
  },
  remotePort: {
    enumerable: true,
    writable: true,
    value: ""
  },
  raw: {
    enumerable: false,
    get: function() {
      return this[rawSymbol$1];
    },
    set: function(val) {
      this[rawSymbol$1] = val;
    }
  }
});
Object.defineProperty(pinoReqProto, rawSymbol$1, {
  writable: true,
  value: {}
});
function reqSerializer(req2) {
  const connection = req2.info || req2.socket;
  const _req = Object.create(pinoReqProto);
  _req.id = typeof req2.id === "function" ? req2.id() : req2.id || (req2.info ? req2.info.id : void 0);
  _req.method = req2.method;
  if (req2.originalUrl) {
    _req.url = req2.originalUrl;
  } else {
    const path2 = req2.path;
    _req.url = typeof path2 === "string" ? path2 : req2.url ? req2.url.path || req2.url : void 0;
  }
  if (req2.query) {
    _req.query = req2.query;
  }
  if (req2.params) {
    _req.params = req2.params;
  }
  _req.headers = req2.headers;
  _req.remoteAddress = connection && connection.remoteAddress;
  _req.remotePort = connection && connection.remotePort;
  _req.raw = req2.raw || req2;
  return _req;
}
function mapHttpRequest$1(req2) {
  return {
    req: reqSerializer(req2)
  };
}
var res = {
  mapHttpResponse: mapHttpResponse$1,
  resSerializer
};
const rawSymbol = Symbol("pino-raw-res-ref");
const pinoResProto = Object.create({}, {
  statusCode: {
    enumerable: true,
    writable: true,
    value: 0
  },
  headers: {
    enumerable: true,
    writable: true,
    value: ""
  },
  raw: {
    enumerable: false,
    get: function() {
      return this[rawSymbol];
    },
    set: function(val) {
      this[rawSymbol] = val;
    }
  }
});
Object.defineProperty(pinoResProto, rawSymbol, {
  writable: true,
  value: {}
});
function resSerializer(res2) {
  const _res = Object.create(pinoResProto);
  _res.statusCode = res2.headersSent ? res2.statusCode : null;
  _res.headers = res2.getHeaders ? res2.getHeaders() : res2._headers;
  _res.raw = res2;
  return _res;
}
function mapHttpResponse$1(res2) {
  return {
    res: resSerializer(res2)
  };
}
const errSerializer = err;
const errWithCauseSerializer = errWithCause;
const reqSerializers = req;
const resSerializers = res;
var pinoStdSerializers = {
  err: errSerializer,
  errWithCause: errWithCauseSerializer,
  mapHttpRequest: reqSerializers.mapHttpRequest,
  mapHttpResponse: resSerializers.mapHttpResponse,
  req: reqSerializers.reqSerializer,
  res: resSerializers.resSerializer,
  wrapErrorSerializer: function wrapErrorSerializer(customSerializer) {
    if (customSerializer === errSerializer) return customSerializer;
    return function wrapErrSerializer(err2) {
      return customSerializer(errSerializer(err2));
    };
  },
  wrapRequestSerializer: function wrapRequestSerializer(customSerializer) {
    if (customSerializer === reqSerializers.reqSerializer) return customSerializer;
    return function wrappedReqSerializer(req2) {
      return customSerializer(reqSerializers.reqSerializer(req2));
    };
  },
  wrapResponseSerializer: function wrapResponseSerializer(customSerializer) {
    if (customSerializer === resSerializers.resSerializer) return customSerializer;
    return function wrappedResSerializer(res2) {
      return customSerializer(resSerializers.resSerializer(res2));
    };
  }
};
function noOpPrepareStackTrace(_, stack) {
  return stack;
}
var caller$1 = function getCallers() {
  const originalPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = noOpPrepareStackTrace;
  const stack = new Error().stack;
  Error.prepareStackTrace = originalPrepare;
  if (!Array.isArray(stack)) {
    return void 0;
  }
  const entries = stack.slice(2);
  const fileNames = [];
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    fileNames.push(entry.getFileName());
  }
  return fileNames;
};
var validator_1 = validator$2;
function validator$2(opts = {}) {
  const {
    ERR_PATHS_MUST_BE_STRINGS = () => "fast-redact - Paths must be (non-empty) strings",
    ERR_INVALID_PATH = (s) => `fast-redact – Invalid path (${s})`
  } = opts;
  return function validate2({ paths }) {
    paths.forEach((s) => {
      if (typeof s !== "string") {
        throw Error(ERR_PATHS_MUST_BE_STRINGS());
      }
      try {
        if (/〇/.test(s)) throw Error();
        const expr = (s[0] === "[" ? "" : ".") + s.replace(/^\*/, "〇").replace(/\.\*/g, ".〇").replace(/\[\*\]/g, "[〇]");
        if (/\n|\r|;/.test(expr)) throw Error();
        if (/\/\*/.test(expr)) throw Error();
        Function(`
            'use strict'
            const o = new Proxy({}, { get: () => o, set: () => { throw Error() } });
            const 〇 = null;
            o${expr}
            if ([o${expr}].length !== 1) throw Error()`)();
      } catch (e) {
        throw Error(ERR_INVALID_PATH(s));
      }
    });
  };
}
var rx$4 = /[^.[\]]+|\[((?:.)*?)\]/g;
const rx$3 = rx$4;
var parse_1 = parse$1;
function parse$1({ paths }) {
  const wildcards = [];
  var wcLen = 0;
  const secret = paths.reduce(function(o, strPath, ix) {
    var path2 = strPath.match(rx$3).map((p) => p.replace(/'|"|`/g, ""));
    const leadingBracket = strPath[0] === "[";
    path2 = path2.map((p) => {
      if (p[0] === "[") return p.substr(1, p.length - 2);
      else return p;
    });
    const star = path2.indexOf("*");
    if (star > -1) {
      const before = path2.slice(0, star);
      const beforeStr = before.join(".");
      const after = path2.slice(star + 1, path2.length);
      const nested = after.length > 0;
      wcLen++;
      wildcards.push({
        before,
        beforeStr,
        after,
        nested
      });
    } else {
      o[strPath] = {
        path: path2,
        val: void 0,
        precensored: false,
        circle: "",
        escPath: JSON.stringify(strPath),
        leadingBracket
      };
    }
    return o;
  }, {});
  return { wildcards, wcLen, secret };
}
const rx$2 = rx$4;
var redactor_1 = redactor$1;
function redactor$1({ secret, serialize, wcLen, strict: strict2, isCensorFct, censorFctTakesPath }, state2) {
  const redact = Function("o", `
    if (typeof o !== 'object' || o == null) {
      ${strictImpl(strict2, serialize)}
    }
    const { censor, secret } = this
    const originalSecret = {}
    const secretKeys = Object.keys(secret)
    for (var i = 0; i < secretKeys.length; i++) {
      originalSecret[secretKeys[i]] = secret[secretKeys[i]]
    }

    ${redactTmpl(secret, isCensorFct, censorFctTakesPath)}
    this.compileRestore()
    ${dynamicRedactTmpl(wcLen > 0, isCensorFct, censorFctTakesPath)}
    this.secret = originalSecret
    ${resultTmpl(serialize)}
  `).bind(state2);
  redact.state = state2;
  if (serialize === false) {
    redact.restore = (o) => state2.restore(o);
  }
  return redact;
}
function redactTmpl(secret, isCensorFct, censorFctTakesPath) {
  return Object.keys(secret).map((path2) => {
    const { escPath, leadingBracket, path: arrPath } = secret[path2];
    const skip = leadingBracket ? 1 : 0;
    const delim = leadingBracket ? "" : ".";
    const hops = [];
    var match;
    while ((match = rx$2.exec(path2)) !== null) {
      const [, ix] = match;
      const { index, input } = match;
      if (index > skip) hops.push(input.substring(0, index - (ix ? 0 : 1)));
    }
    var existence = hops.map((p) => `o${delim}${p}`).join(" && ");
    if (existence.length === 0) existence += `o${delim}${path2} != null`;
    else existence += ` && o${delim}${path2} != null`;
    const circularDetection = `
      switch (true) {
        ${hops.reverse().map((p) => `
          case o${delim}${p} === censor:
            secret[${escPath}].circle = ${JSON.stringify(p)}
            break
        `).join("\n")}
      }
    `;
    const censorArgs = censorFctTakesPath ? `val, ${JSON.stringify(arrPath)}` : `val`;
    return `
      if (${existence}) {
        const val = o${delim}${path2}
        if (val === censor) {
          secret[${escPath}].precensored = true
        } else {
          secret[${escPath}].val = val
          o${delim}${path2} = ${isCensorFct ? `censor(${censorArgs})` : "censor"}
          ${circularDetection}
        }
      }
    `;
  }).join("\n");
}
function dynamicRedactTmpl(hasWildcards, isCensorFct, censorFctTakesPath) {
  return hasWildcards === true ? `
    {
      const { wildcards, wcLen, groupRedact, nestedRedact } = this
      for (var i = 0; i < wcLen; i++) {
        const { before, beforeStr, after, nested } = wildcards[i]
        if (nested === true) {
          secret[beforeStr] = secret[beforeStr] || []
          nestedRedact(secret[beforeStr], o, before, after, censor, ${isCensorFct}, ${censorFctTakesPath})
        } else secret[beforeStr] = groupRedact(o, before, censor, ${isCensorFct}, ${censorFctTakesPath})
      }
    }
  ` : "";
}
function resultTmpl(serialize) {
  return serialize === false ? `return o` : `
    var s = this.serialize(o)
    this.restore(o)
    return s
  `;
}
function strictImpl(strict2, serialize) {
  return strict2 === true ? `throw Error('fast-redact: primitives cannot be redacted')` : serialize === false ? `return o` : `return this.serialize(o)`;
}
var modifiers = {
  groupRedact: groupRedact$1,
  groupRestore: groupRestore$1,
  nestedRedact: nestedRedact$1,
  nestedRestore: nestedRestore$1
};
function groupRestore$1({ keys, values, target }) {
  if (target == null || typeof target === "string") return;
  const length = keys.length;
  for (var i = 0; i < length; i++) {
    const k = keys[i];
    target[k] = values[i];
  }
}
function groupRedact$1(o, path2, censor, isCensorFct, censorFctTakesPath) {
  const target = get(o, path2);
  if (target == null || typeof target === "string") return { keys: null, values: null, target, flat: true };
  const keys = Object.keys(target);
  const keysLength = keys.length;
  const pathLength = path2.length;
  const pathWithKey = censorFctTakesPath ? [...path2] : void 0;
  const values = new Array(keysLength);
  for (var i = 0; i < keysLength; i++) {
    const key = keys[i];
    values[i] = target[key];
    if (censorFctTakesPath) {
      pathWithKey[pathLength] = key;
      target[key] = censor(target[key], pathWithKey);
    } else if (isCensorFct) {
      target[key] = censor(target[key]);
    } else {
      target[key] = censor;
    }
  }
  return { keys, values, target, flat: true };
}
function nestedRestore$1(instructions) {
  for (let i = 0; i < instructions.length; i++) {
    const { target, path: path2, value } = instructions[i];
    let current = target;
    for (let i2 = path2.length - 1; i2 > 0; i2--) {
      current = current[path2[i2]];
    }
    current[path2[0]] = value;
  }
}
function nestedRedact$1(store, o, path2, ns, censor, isCensorFct, censorFctTakesPath) {
  const target = get(o, path2);
  if (target == null) return;
  const keys = Object.keys(target);
  const keysLength = keys.length;
  for (var i = 0; i < keysLength; i++) {
    const key = keys[i];
    specialSet(store, target, key, path2, ns, censor, isCensorFct, censorFctTakesPath);
  }
  return store;
}
function has(obj, prop) {
  return obj !== void 0 && obj !== null ? "hasOwn" in Object ? Object.hasOwn(obj, prop) : Object.prototype.hasOwnProperty.call(obj, prop) : false;
}
function specialSet(store, o, k, path2, afterPath, censor, isCensorFct, censorFctTakesPath) {
  const afterPathLen = afterPath.length;
  const lastPathIndex = afterPathLen - 1;
  const originalKey = k;
  var i = -1;
  var n;
  var nv;
  var ov;
  var wc = null;
  var kIsWc;
  var wcov;
  var consecutive = false;
  var level = 0;
  var depth = 0;
  var redactPathCurrent = tree();
  ov = n = o[k];
  if (typeof n !== "object") return;
  while (n != null && ++i < afterPathLen) {
    depth += 1;
    k = afterPath[i];
    if (k !== "*" && !wc && !(typeof n === "object" && k in n)) {
      break;
    }
    if (k === "*") {
      if (wc === "*") {
        consecutive = true;
      }
      wc = k;
      if (i !== lastPathIndex) {
        continue;
      }
    }
    if (wc) {
      const wcKeys = Object.keys(n);
      for (var j = 0; j < wcKeys.length; j++) {
        const wck = wcKeys[j];
        wcov = n[wck];
        kIsWc = k === "*";
        if (consecutive) {
          redactPathCurrent = node(redactPathCurrent, wck, depth);
          level = i;
          ov = iterateNthLevel(wcov, level - 1, k, path2, afterPath, censor, isCensorFct, censorFctTakesPath, originalKey, n, nv, ov, kIsWc, wck, i, lastPathIndex, redactPathCurrent, store, o[originalKey], depth + 1);
        } else {
          if (kIsWc || typeof wcov === "object" && wcov !== null && k in wcov) {
            if (kIsWc) {
              ov = wcov;
            } else {
              ov = wcov[k];
            }
            nv = i !== lastPathIndex ? ov : isCensorFct ? censorFctTakesPath ? censor(ov, [...path2, originalKey, ...afterPath]) : censor(ov) : censor;
            if (kIsWc) {
              const rv = restoreInstr(node(redactPathCurrent, wck, depth), ov, o[originalKey]);
              store.push(rv);
              n[wck] = nv;
            } else {
              if (wcov[k] === nv) ;
              else if (nv === void 0 && censor !== void 0 || has(wcov, k) && nv === ov) {
                redactPathCurrent = node(redactPathCurrent, wck, depth);
              } else {
                redactPathCurrent = node(redactPathCurrent, wck, depth);
                const rv = restoreInstr(node(redactPathCurrent, k, depth + 1), ov, o[originalKey]);
                store.push(rv);
                wcov[k] = nv;
              }
            }
          }
        }
      }
      wc = null;
    } else {
      ov = n[k];
      redactPathCurrent = node(redactPathCurrent, k, depth);
      nv = i !== lastPathIndex ? ov : isCensorFct ? censorFctTakesPath ? censor(ov, [...path2, originalKey, ...afterPath]) : censor(ov) : censor;
      if (has(n, k) && nv === ov || nv === void 0 && censor !== void 0) ;
      else {
        const rv = restoreInstr(redactPathCurrent, ov, o[originalKey]);
        store.push(rv);
        n[k] = nv;
      }
      n = n[k];
    }
    if (typeof n !== "object") break;
  }
}
function get(o, p) {
  var i = -1;
  var l = p.length;
  var n = o;
  while (n != null && ++i < l) {
    n = n[p[i]];
  }
  return n;
}
function iterateNthLevel(wcov, level, k, path2, afterPath, censor, isCensorFct, censorFctTakesPath, originalKey, n, nv, ov, kIsWc, wck, i, lastPathIndex, redactPathCurrent, store, parent, depth) {
  if (level === 0) {
    if (kIsWc || typeof wcov === "object" && wcov !== null && k in wcov) {
      if (kIsWc) {
        ov = wcov;
      } else {
        ov = wcov[k];
      }
      nv = i !== lastPathIndex ? ov : isCensorFct ? censorFctTakesPath ? censor(ov, [...path2, originalKey, ...afterPath]) : censor(ov) : censor;
      if (kIsWc) {
        const rv = restoreInstr(redactPathCurrent, ov, parent);
        store.push(rv);
        n[wck] = nv;
      } else {
        if (wcov[k] === nv) ;
        else if (nv === void 0 && censor !== void 0 || has(wcov, k) && nv === ov) ;
        else {
          const rv = restoreInstr(node(redactPathCurrent, k, depth + 1), ov, parent);
          store.push(rv);
          wcov[k] = nv;
        }
      }
    }
  }
  for (const key in wcov) {
    if (typeof wcov[key] === "object") {
      redactPathCurrent = node(redactPathCurrent, key, depth);
      iterateNthLevel(wcov[key], level - 1, k, path2, afterPath, censor, isCensorFct, censorFctTakesPath, originalKey, n, nv, ov, kIsWc, wck, i, lastPathIndex, redactPathCurrent, store, parent, depth + 1);
    }
  }
}
function tree() {
  return { parent: null, key: null, children: [], depth: 0 };
}
function node(parent, key, depth) {
  if (parent.depth === depth) {
    return node(parent.parent, key, depth);
  }
  var child2 = {
    parent,
    key,
    depth,
    children: []
  };
  parent.children.push(child2);
  return child2;
}
function restoreInstr(node2, value, target) {
  let current = node2;
  const path2 = [];
  do {
    path2.push(current.key);
    current = current.parent;
  } while (current.parent != null);
  return { path: path2, value, target };
}
const { groupRestore, nestedRestore } = modifiers;
var restorer_1 = restorer$1;
function restorer$1() {
  return function compileRestore() {
    if (this.restore) {
      this.restore.state.secret = this.secret;
      return;
    }
    const { secret, wcLen } = this;
    const paths = Object.keys(secret);
    const resetters = resetTmpl(secret, paths);
    const hasWildcards = wcLen > 0;
    const state2 = hasWildcards ? { secret, groupRestore, nestedRestore } : { secret };
    this.restore = Function(
      "o",
      restoreTmpl(resetters, paths, hasWildcards)
    ).bind(state2);
    this.restore.state = state2;
  };
}
function resetTmpl(secret, paths) {
  return paths.map((path2) => {
    const { circle, escPath, leadingBracket } = secret[path2];
    const delim = leadingBracket ? "" : ".";
    const reset = circle ? `o.${circle} = secret[${escPath}].val` : `o${delim}${path2} = secret[${escPath}].val`;
    const clear2 = `secret[${escPath}].val = undefined`;
    return `
      if (secret[${escPath}].val !== undefined) {
        try { ${reset} } catch (e) {}
        ${clear2}
      }
    `;
  }).join("");
}
function restoreTmpl(resetters, paths, hasWildcards) {
  const dynamicReset = hasWildcards === true ? `
    const keys = Object.keys(secret)
    const len = keys.length
    for (var i = len - 1; i >= ${paths.length}; i--) {
      const k = keys[i]
      const o = secret[k]
      if (o) {
        if (o.flat === true) this.groupRestore(o)
        else this.nestedRestore(o)
        secret[k] = null
      }
    }
  ` : "";
  return `
    const secret = this.secret
    ${dynamicReset}
    ${resetters}
    return o
  `;
}
var state_1 = state$1;
function state$1(o) {
  const {
    secret,
    censor,
    compileRestore,
    serialize,
    groupRedact: groupRedact2,
    nestedRedact: nestedRedact2,
    wildcards,
    wcLen
  } = o;
  const builder = [{ secret, censor, compileRestore }];
  if (serialize !== false) builder.push({ serialize });
  if (wcLen > 0) builder.push({ groupRedact: groupRedact2, nestedRedact: nestedRedact2, wildcards, wcLen });
  return Object.assign(...builder);
}
const validator$1 = validator_1;
const parse = parse_1;
const redactor = redactor_1;
const restorer = restorer_1;
const { groupRedact, nestedRedact } = modifiers;
const state = state_1;
const rx$1 = rx$4;
const validate$1 = validator$1();
const noop$4 = (o) => o;
noop$4.restore = noop$4;
const DEFAULT_CENSOR = "[REDACTED]";
fastRedact$1.rx = rx$1;
fastRedact$1.validator = validator$1;
var fastRedact_1 = fastRedact$1;
function fastRedact$1(opts = {}) {
  const paths = Array.from(new Set(opts.paths || []));
  const serialize = "serialize" in opts ? opts.serialize === false ? opts.serialize : typeof opts.serialize === "function" ? opts.serialize : JSON.stringify : JSON.stringify;
  const remove = opts.remove;
  if (remove === true && serialize !== JSON.stringify) {
    throw Error("fast-redact – remove option may only be set when serializer is JSON.stringify");
  }
  const censor = remove === true ? void 0 : "censor" in opts ? opts.censor : DEFAULT_CENSOR;
  const isCensorFct = typeof censor === "function";
  const censorFctTakesPath = isCensorFct && censor.length > 1;
  if (paths.length === 0) return serialize || noop$4;
  validate$1({ paths, serialize, censor });
  const { wildcards, wcLen, secret } = parse({ paths, censor });
  const compileRestore = restorer();
  const strict2 = "strict" in opts ? opts.strict : true;
  return redactor({ secret, wcLen, serialize, strict: strict2, isCensorFct, censorFctTakesPath }, state({
    secret,
    censor,
    compileRestore,
    serialize,
    groupRedact,
    nestedRedact,
    wildcards,
    wcLen
  }));
}
const setLevelSym$2 = Symbol("pino.setLevel");
const getLevelSym$1 = Symbol("pino.getLevel");
const levelValSym$2 = Symbol("pino.levelVal");
const levelCompSym$2 = Symbol("pino.levelComp");
const useLevelLabelsSym = Symbol("pino.useLevelLabels");
const useOnlyCustomLevelsSym$3 = Symbol("pino.useOnlyCustomLevels");
const mixinSym$2 = Symbol("pino.mixin");
const lsCacheSym$3 = Symbol("pino.lsCache");
const chindingsSym$3 = Symbol("pino.chindings");
const asJsonSym$1 = Symbol("pino.asJson");
const writeSym$2 = Symbol("pino.write");
const redactFmtSym$3 = Symbol("pino.redactFmt");
const timeSym$2 = Symbol("pino.time");
const timeSliceIndexSym$2 = Symbol("pino.timeSliceIndex");
const streamSym$3 = Symbol("pino.stream");
const stringifySym$3 = Symbol("pino.stringify");
const stringifySafeSym$2 = Symbol("pino.stringifySafe");
const stringifiersSym$3 = Symbol("pino.stringifiers");
const endSym$2 = Symbol("pino.end");
const formatOptsSym$3 = Symbol("pino.formatOpts");
const messageKeySym$3 = Symbol("pino.messageKey");
const errorKeySym$3 = Symbol("pino.errorKey");
const nestedKeySym$2 = Symbol("pino.nestedKey");
const nestedKeyStrSym$2 = Symbol("pino.nestedKeyStr");
const mixinMergeStrategySym$2 = Symbol("pino.mixinMergeStrategy");
const msgPrefixSym$3 = Symbol("pino.msgPrefix");
const wildcardFirstSym$2 = Symbol("pino.wildcardFirst");
const serializersSym$3 = Symbol.for("pino.serializers");
const formattersSym$4 = Symbol.for("pino.formatters");
const hooksSym$2 = Symbol.for("pino.hooks");
const needsMetadataGsym$1 = Symbol.for("pino.metadata");
var symbols$1 = {
  setLevelSym: setLevelSym$2,
  getLevelSym: getLevelSym$1,
  levelValSym: levelValSym$2,
  levelCompSym: levelCompSym$2,
  useLevelLabelsSym,
  mixinSym: mixinSym$2,
  lsCacheSym: lsCacheSym$3,
  chindingsSym: chindingsSym$3,
  asJsonSym: asJsonSym$1,
  writeSym: writeSym$2,
  serializersSym: serializersSym$3,
  redactFmtSym: redactFmtSym$3,
  timeSym: timeSym$2,
  timeSliceIndexSym: timeSliceIndexSym$2,
  streamSym: streamSym$3,
  stringifySym: stringifySym$3,
  stringifySafeSym: stringifySafeSym$2,
  stringifiersSym: stringifiersSym$3,
  endSym: endSym$2,
  formatOptsSym: formatOptsSym$3,
  messageKeySym: messageKeySym$3,
  errorKeySym: errorKeySym$3,
  nestedKeySym: nestedKeySym$2,
  wildcardFirstSym: wildcardFirstSym$2,
  needsMetadataGsym: needsMetadataGsym$1,
  useOnlyCustomLevelsSym: useOnlyCustomLevelsSym$3,
  formattersSym: formattersSym$4,
  hooksSym: hooksSym$2,
  nestedKeyStrSym: nestedKeyStrSym$2,
  mixinMergeStrategySym: mixinMergeStrategySym$2,
  msgPrefixSym: msgPrefixSym$3
};
const fastRedact = fastRedact_1;
const { redactFmtSym: redactFmtSym$2, wildcardFirstSym: wildcardFirstSym$1 } = symbols$1;
const { rx, validator } = fastRedact;
const validate = validator({
  ERR_PATHS_MUST_BE_STRINGS: () => "pino – redacted paths must be strings",
  ERR_INVALID_PATH: (s) => `pino – redact paths array contains an invalid path (${s})`
});
const CENSOR = "[Redacted]";
const strict = false;
function redaction$2(opts, serialize) {
  const { paths, censor } = handle(opts);
  const shape = paths.reduce((o, str) => {
    rx.lastIndex = 0;
    const first = rx.exec(str);
    const next = rx.exec(str);
    let ns = first[1] !== void 0 ? first[1].replace(/^(?:"|'|`)(.*)(?:"|'|`)$/, "$1") : first[0];
    if (ns === "*") {
      ns = wildcardFirstSym$1;
    }
    if (next === null) {
      o[ns] = null;
      return o;
    }
    if (o[ns] === null) {
      return o;
    }
    const { index } = next;
    const nextPath = `${str.substr(index, str.length - 1)}`;
    o[ns] = o[ns] || [];
    if (ns !== wildcardFirstSym$1 && o[ns].length === 0) {
      o[ns].push(...o[wildcardFirstSym$1] || []);
    }
    if (ns === wildcardFirstSym$1) {
      Object.keys(o).forEach(function(k) {
        if (o[k]) {
          o[k].push(nextPath);
        }
      });
    }
    o[ns].push(nextPath);
    return o;
  }, {});
  const result = {
    [redactFmtSym$2]: fastRedact({ paths, censor, serialize, strict })
  };
  const topCensor = (...args) => {
    return typeof censor === "function" ? serialize(censor(...args)) : serialize(censor);
  };
  return [...Object.keys(shape), ...Object.getOwnPropertySymbols(shape)].reduce((o, k) => {
    if (shape[k] === null) {
      o[k] = (value) => topCensor(value, [k]);
    } else {
      const wrappedCensor = typeof censor === "function" ? (value, path2) => {
        return censor(value, [k, ...path2]);
      } : censor;
      o[k] = fastRedact({
        paths: shape[k],
        censor: wrappedCensor,
        serialize,
        strict
      });
    }
    return o;
  }, result);
}
function handle(opts) {
  if (Array.isArray(opts)) {
    opts = { paths: opts, censor: CENSOR };
    validate(opts);
    return opts;
  }
  let { paths, censor = CENSOR, remove } = opts;
  if (Array.isArray(paths) === false) {
    throw Error("pino – redact must contain an array of strings");
  }
  if (remove === true) censor = void 0;
  validate({ paths, censor });
  return { paths, censor };
}
var redaction_1 = redaction$2;
const nullTime$1 = () => "";
const epochTime$1 = () => `,"time":${Date.now()}`;
const unixTime = () => `,"time":${Math.round(Date.now() / 1e3)}`;
const isoTime = () => `,"time":"${new Date(Date.now()).toISOString()}"`;
var time$1 = { nullTime: nullTime$1, epochTime: epochTime$1, unixTime, isoTime };
function tryStringify(o) {
  try {
    return JSON.stringify(o);
  } catch (e) {
    return '"[Circular]"';
  }
}
var quickFormatUnescaped = format$1;
function format$1(f, args, opts) {
  var ss = opts && opts.stringify || tryStringify;
  var offset = 1;
  if (typeof f === "object" && f !== null) {
    var len = args.length + offset;
    if (len === 1) return f;
    var objects = new Array(len);
    objects[0] = ss(f);
    for (var index = 1; index < len; index++) {
      objects[index] = ss(args[index]);
    }
    return objects.join(" ");
  }
  if (typeof f !== "string") {
    return f;
  }
  var argLen = args.length;
  if (argLen === 0) return f;
  var str = "";
  var a = 1 - offset;
  var lastPos = -1;
  var flen = f && f.length || 0;
  for (var i = 0; i < flen; ) {
    if (f.charCodeAt(i) === 37 && i + 1 < flen) {
      lastPos = lastPos > -1 ? lastPos : 0;
      switch (f.charCodeAt(i + 1)) {
        case 100:
        case 102:
          if (a >= argLen)
            break;
          if (args[a] == null) break;
          if (lastPos < i)
            str += f.slice(lastPos, i);
          str += Number(args[a]);
          lastPos = i + 2;
          i++;
          break;
        case 105:
          if (a >= argLen)
            break;
          if (args[a] == null) break;
          if (lastPos < i)
            str += f.slice(lastPos, i);
          str += Math.floor(Number(args[a]));
          lastPos = i + 2;
          i++;
          break;
        case 79:
        case 111:
        case 106:
          if (a >= argLen)
            break;
          if (args[a] === void 0) break;
          if (lastPos < i)
            str += f.slice(lastPos, i);
          var type = typeof args[a];
          if (type === "string") {
            str += "'" + args[a] + "'";
            lastPos = i + 2;
            i++;
            break;
          }
          if (type === "function") {
            str += args[a].name || "<anonymous>";
            lastPos = i + 2;
            i++;
            break;
          }
          str += ss(args[a]);
          lastPos = i + 2;
          i++;
          break;
        case 115:
          if (a >= argLen)
            break;
          if (lastPos < i)
            str += f.slice(lastPos, i);
          str += String(args[a]);
          lastPos = i + 2;
          i++;
          break;
        case 37:
          if (lastPos < i)
            str += f.slice(lastPos, i);
          str += "%";
          lastPos = i + 2;
          i++;
          a--;
          break;
      }
      ++a;
    }
    ++i;
  }
  if (lastPos === -1)
    return f;
  else if (lastPos < flen) {
    str += f.slice(lastPos);
  }
  return str;
}
var atomicSleep = { exports: {} };
var hasRequiredAtomicSleep;
function requireAtomicSleep() {
  if (hasRequiredAtomicSleep) return atomicSleep.exports;
  hasRequiredAtomicSleep = 1;
  if (typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined") {
    let sleep2 = function(ms2) {
      const valid = ms2 > 0 && ms2 < Infinity;
      if (valid === false) {
        if (typeof ms2 !== "number" && typeof ms2 !== "bigint") {
          throw TypeError("sleep: ms must be a number");
        }
        throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
      }
      Atomics.wait(nil, 0, 0, Number(ms2));
    };
    const nil = new Int32Array(new SharedArrayBuffer(4));
    atomicSleep.exports = sleep2;
  } else {
    let sleep2 = function(ms2) {
      const valid = ms2 > 0 && ms2 < Infinity;
      if (valid === false) {
        if (typeof ms2 !== "number" && typeof ms2 !== "bigint") {
          throw TypeError("sleep: ms must be a number");
        }
        throw RangeError("sleep: ms must be a number that is greater than 0 but less than Infinity");
      }
    };
    atomicSleep.exports = sleep2;
  }
  return atomicSleep.exports;
}
const fs = require$$0$2;
const EventEmitter$1 = require$$1$2;
const inherits = require$$1$1.inherits;
const path = require$$3;
const sleep = requireAtomicSleep();
const assert = require$$5;
const BUSY_WRITE_TIMEOUT = 100;
const kEmptyBuffer = Buffer.allocUnsafe(0);
const MAX_WRITE = 16 * 1024;
const kContentModeBuffer = "buffer";
const kContentModeUtf8 = "utf8";
const [major, minor] = (process.versions.node || "0.0").split(".").map(Number);
const kCopyBuffer = major >= 22 && minor >= 7;
function openFile(file, sonic) {
  sonic._opening = true;
  sonic._writing = true;
  sonic._asyncDrainScheduled = false;
  function fileOpened(err2, fd) {
    if (err2) {
      sonic._reopening = false;
      sonic._writing = false;
      sonic._opening = false;
      if (sonic.sync) {
        process.nextTick(() => {
          if (sonic.listenerCount("error") > 0) {
            sonic.emit("error", err2);
          }
        });
      } else {
        sonic.emit("error", err2);
      }
      return;
    }
    const reopening = sonic._reopening;
    sonic.fd = fd;
    sonic.file = file;
    sonic._reopening = false;
    sonic._opening = false;
    sonic._writing = false;
    if (sonic.sync) {
      process.nextTick(() => sonic.emit("ready"));
    } else {
      sonic.emit("ready");
    }
    if (sonic.destroyed) {
      return;
    }
    if (!sonic._writing && sonic._len > sonic.minLength || sonic._flushPending) {
      sonic._actualWrite();
    } else if (reopening) {
      process.nextTick(() => sonic.emit("drain"));
    }
  }
  const flags = sonic.append ? "a" : "w";
  const mode = sonic.mode;
  if (sonic.sync) {
    try {
      if (sonic.mkdir) fs.mkdirSync(path.dirname(file), { recursive: true });
      const fd = fs.openSync(file, flags, mode);
      fileOpened(null, fd);
    } catch (err2) {
      fileOpened(err2);
      throw err2;
    }
  } else if (sonic.mkdir) {
    fs.mkdir(path.dirname(file), { recursive: true }, (err2) => {
      if (err2) return fileOpened(err2);
      fs.open(file, flags, mode, fileOpened);
    });
  } else {
    fs.open(file, flags, mode, fileOpened);
  }
}
function SonicBoom$1(opts) {
  if (!(this instanceof SonicBoom$1)) {
    return new SonicBoom$1(opts);
  }
  let { fd, dest, minLength, maxLength, maxWrite, periodicFlush, sync, append = true, mkdir, retryEAGAIN, fsync, contentMode, mode } = opts || {};
  fd = fd || dest;
  this._len = 0;
  this.fd = -1;
  this._bufs = [];
  this._lens = [];
  this._writing = false;
  this._ending = false;
  this._reopening = false;
  this._asyncDrainScheduled = false;
  this._flushPending = false;
  this._hwm = Math.max(minLength || 0, 16387);
  this.file = null;
  this.destroyed = false;
  this.minLength = minLength || 0;
  this.maxLength = maxLength || 0;
  this.maxWrite = maxWrite || MAX_WRITE;
  this._periodicFlush = periodicFlush || 0;
  this._periodicFlushTimer = void 0;
  this.sync = sync || false;
  this.writable = true;
  this._fsync = fsync || false;
  this.append = append || false;
  this.mode = mode;
  this.retryEAGAIN = retryEAGAIN || (() => true);
  this.mkdir = mkdir || false;
  let fsWriteSync;
  let fsWrite;
  if (contentMode === kContentModeBuffer) {
    this._writingBuf = kEmptyBuffer;
    this.write = writeBuffer;
    this.flush = flushBuffer;
    this.flushSync = flushBufferSync;
    this._actualWrite = actualWriteBuffer;
    fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf);
    fsWrite = () => fs.write(this.fd, this._writingBuf, this.release);
  } else if (contentMode === void 0 || contentMode === kContentModeUtf8) {
    this._writingBuf = "";
    this.write = write$1;
    this.flush = flush$1;
    this.flushSync = flushSync;
    this._actualWrite = actualWrite;
    fsWriteSync = () => fs.writeSync(this.fd, this._writingBuf, "utf8");
    fsWrite = () => fs.write(this.fd, this._writingBuf, "utf8", this.release);
  } else {
    throw new Error(`SonicBoom supports "${kContentModeUtf8}" and "${kContentModeBuffer}", but passed ${contentMode}`);
  }
  if (typeof fd === "number") {
    this.fd = fd;
    process.nextTick(() => this.emit("ready"));
  } else if (typeof fd === "string") {
    openFile(fd, this);
  } else {
    throw new Error("SonicBoom supports only file descriptors and files");
  }
  if (this.minLength >= this.maxWrite) {
    throw new Error(`minLength should be smaller than maxWrite (${this.maxWrite})`);
  }
  this.release = (err2, n) => {
    if (err2) {
      if ((err2.code === "EAGAIN" || err2.code === "EBUSY") && this.retryEAGAIN(err2, this._writingBuf.length, this._len - this._writingBuf.length)) {
        if (this.sync) {
          try {
            sleep(BUSY_WRITE_TIMEOUT);
            this.release(void 0, 0);
          } catch (err3) {
            this.release(err3);
          }
        } else {
          setTimeout(fsWrite, BUSY_WRITE_TIMEOUT);
        }
      } else {
        this._writing = false;
        this.emit("error", err2);
      }
      return;
    }
    this.emit("write", n);
    const releasedBufObj = releaseWritingBuf(this._writingBuf, this._len, n);
    this._len = releasedBufObj.len;
    this._writingBuf = releasedBufObj.writingBuf;
    if (this._writingBuf.length) {
      if (!this.sync) {
        fsWrite();
        return;
      }
      try {
        do {
          const n2 = fsWriteSync();
          const releasedBufObj2 = releaseWritingBuf(this._writingBuf, this._len, n2);
          this._len = releasedBufObj2.len;
          this._writingBuf = releasedBufObj2.writingBuf;
        } while (this._writingBuf.length);
      } catch (err3) {
        this.release(err3);
        return;
      }
    }
    if (this._fsync) {
      fs.fsyncSync(this.fd);
    }
    const len = this._len;
    if (this._reopening) {
      this._writing = false;
      this._reopening = false;
      this.reopen();
    } else if (len > this.minLength) {
      this._actualWrite();
    } else if (this._ending) {
      if (len > 0) {
        this._actualWrite();
      } else {
        this._writing = false;
        actualClose(this);
      }
    } else {
      this._writing = false;
      if (this.sync) {
        if (!this._asyncDrainScheduled) {
          this._asyncDrainScheduled = true;
          process.nextTick(emitDrain, this);
        }
      } else {
        this.emit("drain");
      }
    }
  };
  this.on("newListener", function(name2) {
    if (name2 === "drain") {
      this._asyncDrainScheduled = false;
    }
  });
  if (this._periodicFlush !== 0) {
    this._periodicFlushTimer = setInterval(() => this.flush(null), this._periodicFlush);
    this._periodicFlushTimer.unref();
  }
}
function releaseWritingBuf(writingBuf, len, n) {
  if (typeof writingBuf === "string" && Buffer.byteLength(writingBuf) !== n) {
    n = Buffer.from(writingBuf).subarray(0, n).toString().length;
  }
  len = Math.max(len - n, 0);
  writingBuf = writingBuf.slice(n);
  return { writingBuf, len };
}
function emitDrain(sonic) {
  const hasListeners = sonic.listenerCount("drain") > 0;
  if (!hasListeners) return;
  sonic._asyncDrainScheduled = false;
  sonic.emit("drain");
}
inherits(SonicBoom$1, EventEmitter$1);
function mergeBuf(bufs, len) {
  if (bufs.length === 0) {
    return kEmptyBuffer;
  }
  if (bufs.length === 1) {
    return bufs[0];
  }
  return Buffer.concat(bufs, len);
}
function write$1(data) {
  if (this.destroyed) {
    throw new Error("SonicBoom destroyed");
  }
  const len = this._len + data.length;
  const bufs = this._bufs;
  if (this.maxLength && len > this.maxLength) {
    this.emit("drop", data);
    return this._len < this._hwm;
  }
  if (bufs.length === 0 || bufs[bufs.length - 1].length + data.length > this.maxWrite) {
    bufs.push("" + data);
  } else {
    bufs[bufs.length - 1] += data;
  }
  this._len = len;
  if (!this._writing && this._len >= this.minLength) {
    this._actualWrite();
  }
  return this._len < this._hwm;
}
function writeBuffer(data) {
  if (this.destroyed) {
    throw new Error("SonicBoom destroyed");
  }
  const len = this._len + data.length;
  const bufs = this._bufs;
  const lens = this._lens;
  if (this.maxLength && len > this.maxLength) {
    this.emit("drop", data);
    return this._len < this._hwm;
  }
  if (bufs.length === 0 || lens[lens.length - 1] + data.length > this.maxWrite) {
    bufs.push([data]);
    lens.push(data.length);
  } else {
    bufs[bufs.length - 1].push(data);
    lens[lens.length - 1] += data.length;
  }
  this._len = len;
  if (!this._writing && this._len >= this.minLength) {
    this._actualWrite();
  }
  return this._len < this._hwm;
}
function callFlushCallbackOnDrain(cb) {
  this._flushPending = true;
  const onDrain = () => {
    if (!this._fsync) {
      try {
        fs.fsync(this.fd, (err2) => {
          this._flushPending = false;
          cb(err2);
        });
      } catch (err2) {
        cb(err2);
      }
    } else {
      this._flushPending = false;
      cb();
    }
    this.off("error", onError);
  };
  const onError = (err2) => {
    this._flushPending = false;
    cb(err2);
    this.off("drain", onDrain);
  };
  this.once("drain", onDrain);
  this.once("error", onError);
}
function flush$1(cb) {
  if (cb != null && typeof cb !== "function") {
    throw new Error("flush cb must be a function");
  }
  if (this.destroyed) {
    const error = new Error("SonicBoom destroyed");
    if (cb) {
      cb(error);
      return;
    }
    throw error;
  }
  if (this.minLength <= 0) {
    cb == null ? void 0 : cb();
    return;
  }
  if (cb) {
    callFlushCallbackOnDrain.call(this, cb);
  }
  if (this._writing) {
    return;
  }
  if (this._bufs.length === 0) {
    this._bufs.push("");
  }
  this._actualWrite();
}
function flushBuffer(cb) {
  if (cb != null && typeof cb !== "function") {
    throw new Error("flush cb must be a function");
  }
  if (this.destroyed) {
    const error = new Error("SonicBoom destroyed");
    if (cb) {
      cb(error);
      return;
    }
    throw error;
  }
  if (this.minLength <= 0) {
    cb == null ? void 0 : cb();
    return;
  }
  if (cb) {
    callFlushCallbackOnDrain.call(this, cb);
  }
  if (this._writing) {
    return;
  }
  if (this._bufs.length === 0) {
    this._bufs.push([]);
    this._lens.push(0);
  }
  this._actualWrite();
}
SonicBoom$1.prototype.reopen = function(file) {
  if (this.destroyed) {
    throw new Error("SonicBoom destroyed");
  }
  if (this._opening) {
    this.once("ready", () => {
      this.reopen(file);
    });
    return;
  }
  if (this._ending) {
    return;
  }
  if (!this.file) {
    throw new Error("Unable to reopen a file descriptor, you must pass a file to SonicBoom");
  }
  if (file) {
    this.file = file;
  }
  this._reopening = true;
  if (this._writing) {
    return;
  }
  const fd = this.fd;
  this.once("ready", () => {
    if (fd !== this.fd) {
      fs.close(fd, (err2) => {
        if (err2) {
          return this.emit("error", err2);
        }
      });
    }
  });
  openFile(this.file, this);
};
SonicBoom$1.prototype.end = function() {
  if (this.destroyed) {
    throw new Error("SonicBoom destroyed");
  }
  if (this._opening) {
    this.once("ready", () => {
      this.end();
    });
    return;
  }
  if (this._ending) {
    return;
  }
  this._ending = true;
  if (this._writing) {
    return;
  }
  if (this._len > 0 && this.fd >= 0) {
    this._actualWrite();
  } else {
    actualClose(this);
  }
};
function flushSync() {
  if (this.destroyed) {
    throw new Error("SonicBoom destroyed");
  }
  if (this.fd < 0) {
    throw new Error("sonic boom is not ready yet");
  }
  if (!this._writing && this._writingBuf.length > 0) {
    this._bufs.unshift(this._writingBuf);
    this._writingBuf = "";
  }
  let buf = "";
  while (this._bufs.length || buf) {
    if (buf.length <= 0) {
      buf = this._bufs[0];
    }
    try {
      const n = fs.writeSync(this.fd, buf, "utf8");
      const releasedBufObj = releaseWritingBuf(buf, this._len, n);
      buf = releasedBufObj.writingBuf;
      this._len = releasedBufObj.len;
      if (buf.length <= 0) {
        this._bufs.shift();
      }
    } catch (err2) {
      const shouldRetry = err2.code === "EAGAIN" || err2.code === "EBUSY";
      if (shouldRetry && !this.retryEAGAIN(err2, buf.length, this._len - buf.length)) {
        throw err2;
      }
      sleep(BUSY_WRITE_TIMEOUT);
    }
  }
  try {
    fs.fsyncSync(this.fd);
  } catch {
  }
}
function flushBufferSync() {
  if (this.destroyed) {
    throw new Error("SonicBoom destroyed");
  }
  if (this.fd < 0) {
    throw new Error("sonic boom is not ready yet");
  }
  if (!this._writing && this._writingBuf.length > 0) {
    this._bufs.unshift([this._writingBuf]);
    this._writingBuf = kEmptyBuffer;
  }
  let buf = kEmptyBuffer;
  while (this._bufs.length || buf.length) {
    if (buf.length <= 0) {
      buf = mergeBuf(this._bufs[0], this._lens[0]);
    }
    try {
      const n = fs.writeSync(this.fd, buf);
      buf = buf.subarray(n);
      this._len = Math.max(this._len - n, 0);
      if (buf.length <= 0) {
        this._bufs.shift();
        this._lens.shift();
      }
    } catch (err2) {
      const shouldRetry = err2.code === "EAGAIN" || err2.code === "EBUSY";
      if (shouldRetry && !this.retryEAGAIN(err2, buf.length, this._len - buf.length)) {
        throw err2;
      }
      sleep(BUSY_WRITE_TIMEOUT);
    }
  }
}
SonicBoom$1.prototype.destroy = function() {
  if (this.destroyed) {
    return;
  }
  actualClose(this);
};
function actualWrite() {
  const release = this.release;
  this._writing = true;
  this._writingBuf = this._writingBuf || this._bufs.shift() || "";
  if (this.sync) {
    try {
      const written = fs.writeSync(this.fd, this._writingBuf, "utf8");
      release(null, written);
    } catch (err2) {
      release(err2);
    }
  } else {
    fs.write(this.fd, this._writingBuf, "utf8", release);
  }
}
function actualWriteBuffer() {
  const release = this.release;
  this._writing = true;
  this._writingBuf = this._writingBuf.length ? this._writingBuf : mergeBuf(this._bufs.shift(), this._lens.shift());
  if (this.sync) {
    try {
      const written = fs.writeSync(this.fd, this._writingBuf);
      release(null, written);
    } catch (err2) {
      release(err2);
    }
  } else {
    if (kCopyBuffer) {
      this._writingBuf = Buffer.from(this._writingBuf);
    }
    fs.write(this.fd, this._writingBuf, release);
  }
}
function actualClose(sonic) {
  if (sonic.fd === -1) {
    sonic.once("ready", actualClose.bind(null, sonic));
    return;
  }
  if (sonic._periodicFlushTimer !== void 0) {
    clearInterval(sonic._periodicFlushTimer);
  }
  sonic.destroyed = true;
  sonic._bufs = [];
  sonic._lens = [];
  assert(typeof sonic.fd === "number", `sonic.fd must be a number, got ${typeof sonic.fd}`);
  try {
    fs.fsync(sonic.fd, closeWrapped);
  } catch {
  }
  function closeWrapped() {
    if (sonic.fd !== 1 && sonic.fd !== 2) {
      fs.close(sonic.fd, done);
    } else {
      done();
    }
  }
  function done(err2) {
    if (err2) {
      sonic.emit("error", err2);
      return;
    }
    if (sonic._ending && !sonic._writing) {
      sonic.emit("finish");
    }
    sonic.emit("close");
  }
}
SonicBoom$1.SonicBoom = SonicBoom$1;
SonicBoom$1.default = SonicBoom$1;
var sonicBoom = SonicBoom$1;
const refs = {
  exit: [],
  beforeExit: []
};
const functions = {
  exit: onExit$1,
  beforeExit: onBeforeExit
};
let registry;
function ensureRegistry() {
  if (registry === void 0) {
    registry = new FinalizationRegistry(clear);
  }
}
function install(event) {
  if (refs[event].length > 0) {
    return;
  }
  process.on(event, functions[event]);
}
function uninstall(event) {
  if (refs[event].length > 0) {
    return;
  }
  process.removeListener(event, functions[event]);
  if (refs.exit.length === 0 && refs.beforeExit.length === 0) {
    registry = void 0;
  }
}
function onExit$1() {
  callRefs("exit");
}
function onBeforeExit() {
  callRefs("beforeExit");
}
function callRefs(event) {
  for (const ref of refs[event]) {
    const obj = ref.deref();
    const fn = ref.fn;
    if (obj !== void 0) {
      fn(obj, event);
    }
  }
  refs[event] = [];
}
function clear(ref) {
  for (const event of ["exit", "beforeExit"]) {
    const index = refs[event].indexOf(ref);
    refs[event].splice(index, index + 1);
    uninstall(event);
  }
}
function _register(event, obj, fn) {
  if (obj === void 0) {
    throw new Error("the object can't be undefined");
  }
  install(event);
  const ref = new WeakRef(obj);
  ref.fn = fn;
  ensureRegistry();
  registry.register(obj, ref);
  refs[event].push(ref);
}
function register(obj, fn) {
  _register("exit", obj, fn);
}
function registerBeforeExit(obj, fn) {
  _register("beforeExit", obj, fn);
}
function unregister(obj) {
  if (registry === void 0) {
    return;
  }
  registry.unregister(obj);
  for (const event of ["exit", "beforeExit"]) {
    refs[event] = refs[event].filter((ref) => {
      const _obj = ref.deref();
      return _obj && _obj !== obj;
    });
    uninstall(event);
  }
}
var onExitLeakFree = {
  register,
  registerBeforeExit,
  unregister
};
const name = "thread-stream";
const version$2 = "3.1.0";
const description = "A streaming way to send data to a Node.js Worker Thread";
const main = "index.js";
const types = "index.d.ts";
const dependencies = {
  "real-require": "^0.2.0"
};
const devDependencies = {
  "@types/node": "^20.1.0",
  "@types/tap": "^15.0.0",
  "@yao-pkg/pkg": "^5.11.5",
  desm: "^1.3.0",
  fastbench: "^1.0.1",
  husky: "^9.0.6",
  "pino-elasticsearch": "^8.0.0",
  "sonic-boom": "^4.0.1",
  standard: "^17.0.0",
  tap: "^16.2.0",
  "ts-node": "^10.8.0",
  typescript: "^5.3.2",
  "why-is-node-running": "^2.2.2"
};
const scripts = {
  build: "tsc --noEmit",
  test: 'standard && npm run build && npm run transpile && tap "test/**/*.test.*js" && tap --ts test/*.test.*ts',
  "test:ci": "standard && npm run transpile && npm run test:ci:js && npm run test:ci:ts",
  "test:ci:js": 'tap --no-check-coverage --timeout=120 --coverage-report=lcovonly "test/**/*.test.*js"',
  "test:ci:ts": 'tap --ts --no-check-coverage --coverage-report=lcovonly "test/**/*.test.*ts"',
  "test:yarn": 'npm run transpile && tap "test/**/*.test.js" --no-check-coverage',
  transpile: "sh ./test/ts/transpile.sh",
  prepare: "husky install"
};
const standard = {
  ignore: [
    "test/ts/**/*",
    "test/syntax-error.mjs"
  ]
};
const repository = {
  type: "git",
  url: "git+https://github.com/mcollina/thread-stream.git"
};
const keywords = [
  "worker",
  "thread",
  "threads",
  "stream"
];
const author = "Matteo Collina <hello@matteocollina.com>";
const license = "MIT";
const bugs = {
  url: "https://github.com/mcollina/thread-stream/issues"
};
const homepage = "https://github.com/mcollina/thread-stream#readme";
const require$$0 = {
  name,
  version: version$2,
  description,
  main,
  types,
  dependencies,
  devDependencies,
  scripts,
  standard,
  repository,
  keywords,
  author,
  license,
  bugs,
  homepage
};
var wait_1;
var hasRequiredWait;
function requireWait() {
  if (hasRequiredWait) return wait_1;
  hasRequiredWait = 1;
  const MAX_TIMEOUT = 1e3;
  function wait(state2, index, expected, timeout, done) {
    const max = Date.now() + timeout;
    let current = Atomics.load(state2, index);
    if (current === expected) {
      done(null, "ok");
      return;
    }
    let prior = current;
    const check = (backoff) => {
      if (Date.now() > max) {
        done(null, "timed-out");
      } else {
        setTimeout(() => {
          prior = current;
          current = Atomics.load(state2, index);
          if (current === prior) {
            check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
          } else {
            if (current === expected) done(null, "ok");
            else done(null, "not-equal");
          }
        }, backoff);
      }
    };
    check(1);
  }
  function waitDiff(state2, index, expected, timeout, done) {
    const max = Date.now() + timeout;
    let current = Atomics.load(state2, index);
    if (current !== expected) {
      done(null, "ok");
      return;
    }
    const check = (backoff) => {
      if (Date.now() > max) {
        done(null, "timed-out");
      } else {
        setTimeout(() => {
          current = Atomics.load(state2, index);
          if (current !== expected) {
            done(null, "ok");
          } else {
            check(backoff >= MAX_TIMEOUT ? MAX_TIMEOUT : backoff * 2);
          }
        }, backoff);
      }
    };
    check(1);
  }
  wait_1 = { wait, waitDiff };
  return wait_1;
}
var indexes;
var hasRequiredIndexes;
function requireIndexes() {
  if (hasRequiredIndexes) return indexes;
  hasRequiredIndexes = 1;
  const WRITE_INDEX = 4;
  const READ_INDEX = 8;
  indexes = {
    WRITE_INDEX,
    READ_INDEX
  };
  return indexes;
}
var threadStream;
var hasRequiredThreadStream;
function requireThreadStream() {
  if (hasRequiredThreadStream) return threadStream;
  hasRequiredThreadStream = 1;
  const { version: version2 } = require$$0;
  const { EventEmitter: EventEmitter2 } = require$$1$2;
  const { Worker } = require$$2;
  const { join } = require$$3;
  const { pathToFileURL } = require$$4;
  const { wait } = requireWait();
  const {
    WRITE_INDEX,
    READ_INDEX
  } = requireIndexes();
  const buffer = require$$7;
  const assert2 = require$$5;
  const kImpl = Symbol("kImpl");
  const MAX_STRING = buffer.constants.MAX_STRING_LENGTH;
  class FakeWeakRef {
    constructor(value) {
      this._value = value;
    }
    deref() {
      return this._value;
    }
  }
  class FakeFinalizationRegistry {
    register() {
    }
    unregister() {
    }
  }
  const FinalizationRegistry2 = process.env.NODE_V8_COVERAGE ? FakeFinalizationRegistry : commonjsGlobal.FinalizationRegistry || FakeFinalizationRegistry;
  const WeakRef2 = process.env.NODE_V8_COVERAGE ? FakeWeakRef : commonjsGlobal.WeakRef || FakeWeakRef;
  const registry2 = new FinalizationRegistry2((worker) => {
    if (worker.exited) {
      return;
    }
    worker.terminate();
  });
  function createWorker(stream, opts) {
    const { filename, workerData } = opts;
    const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
    const toExecute = bundlerOverrides["thread-stream-worker"] || join(__dirname, "lib", "worker.js");
    const worker = new Worker(toExecute, {
      ...opts.workerOpts,
      trackUnmanagedFds: false,
      workerData: {
        filename: filename.indexOf("file://") === 0 ? filename : pathToFileURL(filename).href,
        dataBuf: stream[kImpl].dataBuf,
        stateBuf: stream[kImpl].stateBuf,
        workerData: {
          $context: {
            threadStreamVersion: version2
          },
          ...workerData
        }
      }
    });
    worker.stream = new FakeWeakRef(stream);
    worker.on("message", onWorkerMessage);
    worker.on("exit", onWorkerExit);
    registry2.register(stream, worker);
    return worker;
  }
  function drain(stream) {
    assert2(!stream[kImpl].sync);
    if (stream[kImpl].needDrain) {
      stream[kImpl].needDrain = false;
      stream.emit("drain");
    }
  }
  function nextFlush(stream) {
    const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
    let leftover = stream[kImpl].data.length - writeIndex;
    if (leftover > 0) {
      if (stream[kImpl].buf.length === 0) {
        stream[kImpl].flushing = false;
        if (stream[kImpl].ending) {
          end(stream);
        } else if (stream[kImpl].needDrain) {
          process.nextTick(drain, stream);
        }
        return;
      }
      let toWrite = stream[kImpl].buf.slice(0, leftover);
      let toWriteBytes = Buffer.byteLength(toWrite);
      if (toWriteBytes <= leftover) {
        stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
        write2(stream, toWrite, nextFlush.bind(null, stream));
      } else {
        stream.flush(() => {
          if (stream.destroyed) {
            return;
          }
          Atomics.store(stream[kImpl].state, READ_INDEX, 0);
          Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
          while (toWriteBytes > stream[kImpl].data.length) {
            leftover = leftover / 2;
            toWrite = stream[kImpl].buf.slice(0, leftover);
            toWriteBytes = Buffer.byteLength(toWrite);
          }
          stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
          write2(stream, toWrite, nextFlush.bind(null, stream));
        });
      }
    } else if (leftover === 0) {
      if (writeIndex === 0 && stream[kImpl].buf.length === 0) {
        return;
      }
      stream.flush(() => {
        Atomics.store(stream[kImpl].state, READ_INDEX, 0);
        Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
        nextFlush(stream);
      });
    } else {
      destroy(stream, new Error("overwritten"));
    }
  }
  function onWorkerMessage(msg) {
    const stream = this.stream.deref();
    if (stream === void 0) {
      this.exited = true;
      this.terminate();
      return;
    }
    switch (msg.code) {
      case "READY":
        this.stream = new WeakRef2(stream);
        stream.flush(() => {
          stream[kImpl].ready = true;
          stream.emit("ready");
        });
        break;
      case "ERROR":
        destroy(stream, msg.err);
        break;
      case "EVENT":
        if (Array.isArray(msg.args)) {
          stream.emit(msg.name, ...msg.args);
        } else {
          stream.emit(msg.name, msg.args);
        }
        break;
      case "WARNING":
        process.emitWarning(msg.err);
        break;
      default:
        destroy(stream, new Error("this should not happen: " + msg.code));
    }
  }
  function onWorkerExit(code) {
    const stream = this.stream.deref();
    if (stream === void 0) {
      return;
    }
    registry2.unregister(stream);
    stream.worker.exited = true;
    stream.worker.off("exit", onWorkerExit);
    destroy(stream, code !== 0 ? new Error("the worker thread exited") : null);
  }
  class ThreadStream extends EventEmitter2 {
    constructor(opts = {}) {
      super();
      if (opts.bufferSize < 4) {
        throw new Error("bufferSize must at least fit a 4-byte utf-8 char");
      }
      this[kImpl] = {};
      this[kImpl].stateBuf = new SharedArrayBuffer(128);
      this[kImpl].state = new Int32Array(this[kImpl].stateBuf);
      this[kImpl].dataBuf = new SharedArrayBuffer(opts.bufferSize || 4 * 1024 * 1024);
      this[kImpl].data = Buffer.from(this[kImpl].dataBuf);
      this[kImpl].sync = opts.sync || false;
      this[kImpl].ending = false;
      this[kImpl].ended = false;
      this[kImpl].needDrain = false;
      this[kImpl].destroyed = false;
      this[kImpl].flushing = false;
      this[kImpl].ready = false;
      this[kImpl].finished = false;
      this[kImpl].errored = null;
      this[kImpl].closed = false;
      this[kImpl].buf = "";
      this.worker = createWorker(this, opts);
      this.on("message", (message, transferList) => {
        this.worker.postMessage(message, transferList);
      });
    }
    write(data) {
      if (this[kImpl].destroyed) {
        error(this, new Error("the worker has exited"));
        return false;
      }
      if (this[kImpl].ending) {
        error(this, new Error("the worker is ending"));
        return false;
      }
      if (this[kImpl].flushing && this[kImpl].buf.length + data.length >= MAX_STRING) {
        try {
          writeSync(this);
          this[kImpl].flushing = true;
        } catch (err2) {
          destroy(this, err2);
          return false;
        }
      }
      this[kImpl].buf += data;
      if (this[kImpl].sync) {
        try {
          writeSync(this);
          return true;
        } catch (err2) {
          destroy(this, err2);
          return false;
        }
      }
      if (!this[kImpl].flushing) {
        this[kImpl].flushing = true;
        setImmediate(nextFlush, this);
      }
      this[kImpl].needDrain = this[kImpl].data.length - this[kImpl].buf.length - Atomics.load(this[kImpl].state, WRITE_INDEX) <= 0;
      return !this[kImpl].needDrain;
    }
    end() {
      if (this[kImpl].destroyed) {
        return;
      }
      this[kImpl].ending = true;
      end(this);
    }
    flush(cb) {
      if (this[kImpl].destroyed) {
        if (typeof cb === "function") {
          process.nextTick(cb, new Error("the worker has exited"));
        }
        return;
      }
      const writeIndex = Atomics.load(this[kImpl].state, WRITE_INDEX);
      wait(this[kImpl].state, READ_INDEX, writeIndex, Infinity, (err2, res2) => {
        if (err2) {
          destroy(this, err2);
          process.nextTick(cb, err2);
          return;
        }
        if (res2 === "not-equal") {
          this.flush(cb);
          return;
        }
        process.nextTick(cb);
      });
    }
    flushSync() {
      if (this[kImpl].destroyed) {
        return;
      }
      writeSync(this);
      flushSync2(this);
    }
    unref() {
      this.worker.unref();
    }
    ref() {
      this.worker.ref();
    }
    get ready() {
      return this[kImpl].ready;
    }
    get destroyed() {
      return this[kImpl].destroyed;
    }
    get closed() {
      return this[kImpl].closed;
    }
    get writable() {
      return !this[kImpl].destroyed && !this[kImpl].ending;
    }
    get writableEnded() {
      return this[kImpl].ending;
    }
    get writableFinished() {
      return this[kImpl].finished;
    }
    get writableNeedDrain() {
      return this[kImpl].needDrain;
    }
    get writableObjectMode() {
      return false;
    }
    get writableErrored() {
      return this[kImpl].errored;
    }
  }
  function error(stream, err2) {
    setImmediate(() => {
      stream.emit("error", err2);
    });
  }
  function destroy(stream, err2) {
    if (stream[kImpl].destroyed) {
      return;
    }
    stream[kImpl].destroyed = true;
    if (err2) {
      stream[kImpl].errored = err2;
      error(stream, err2);
    }
    if (!stream.worker.exited) {
      stream.worker.terminate().catch(() => {
      }).then(() => {
        stream[kImpl].closed = true;
        stream.emit("close");
      });
    } else {
      setImmediate(() => {
        stream[kImpl].closed = true;
        stream.emit("close");
      });
    }
  }
  function write2(stream, data, cb) {
    const current = Atomics.load(stream[kImpl].state, WRITE_INDEX);
    const length = Buffer.byteLength(data);
    stream[kImpl].data.write(data, current);
    Atomics.store(stream[kImpl].state, WRITE_INDEX, current + length);
    Atomics.notify(stream[kImpl].state, WRITE_INDEX);
    cb();
    return true;
  }
  function end(stream) {
    if (stream[kImpl].ended || !stream[kImpl].ending || stream[kImpl].flushing) {
      return;
    }
    stream[kImpl].ended = true;
    try {
      stream.flushSync();
      let readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
      Atomics.store(stream[kImpl].state, WRITE_INDEX, -1);
      Atomics.notify(stream[kImpl].state, WRITE_INDEX);
      let spins = 0;
      while (readIndex !== -1) {
        Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
        readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
        if (readIndex === -2) {
          destroy(stream, new Error("end() failed"));
          return;
        }
        if (++spins === 10) {
          destroy(stream, new Error("end() took too long (10s)"));
          return;
        }
      }
      process.nextTick(() => {
        stream[kImpl].finished = true;
        stream.emit("finish");
      });
    } catch (err2) {
      destroy(stream, err2);
    }
  }
  function writeSync(stream) {
    const cb = () => {
      if (stream[kImpl].ending) {
        end(stream);
      } else if (stream[kImpl].needDrain) {
        process.nextTick(drain, stream);
      }
    };
    stream[kImpl].flushing = false;
    while (stream[kImpl].buf.length !== 0) {
      const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
      let leftover = stream[kImpl].data.length - writeIndex;
      if (leftover === 0) {
        flushSync2(stream);
        Atomics.store(stream[kImpl].state, READ_INDEX, 0);
        Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
        continue;
      } else if (leftover < 0) {
        throw new Error("overwritten");
      }
      let toWrite = stream[kImpl].buf.slice(0, leftover);
      let toWriteBytes = Buffer.byteLength(toWrite);
      if (toWriteBytes <= leftover) {
        stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
        write2(stream, toWrite, cb);
      } else {
        flushSync2(stream);
        Atomics.store(stream[kImpl].state, READ_INDEX, 0);
        Atomics.store(stream[kImpl].state, WRITE_INDEX, 0);
        while (toWriteBytes > stream[kImpl].buf.length) {
          leftover = leftover / 2;
          toWrite = stream[kImpl].buf.slice(0, leftover);
          toWriteBytes = Buffer.byteLength(toWrite);
        }
        stream[kImpl].buf = stream[kImpl].buf.slice(leftover);
        write2(stream, toWrite, cb);
      }
    }
  }
  function flushSync2(stream) {
    if (stream[kImpl].flushing) {
      throw new Error("unable to flush while flushing");
    }
    const writeIndex = Atomics.load(stream[kImpl].state, WRITE_INDEX);
    let spins = 0;
    while (true) {
      const readIndex = Atomics.load(stream[kImpl].state, READ_INDEX);
      if (readIndex === -2) {
        throw Error("_flushSync failed");
      }
      if (readIndex !== writeIndex) {
        Atomics.wait(stream[kImpl].state, READ_INDEX, readIndex, 1e3);
      } else {
        break;
      }
      if (++spins === 10) {
        throw new Error("_flushSync took too long (10s)");
      }
    }
  }
  threadStream = ThreadStream;
  return threadStream;
}
var transport_1;
var hasRequiredTransport;
function requireTransport() {
  if (hasRequiredTransport) return transport_1;
  hasRequiredTransport = 1;
  const { createRequire: createRequire2 } = require$$0$3;
  const getCallers2 = caller$1;
  const { join, isAbsolute, sep } = path$1;
  const sleep2 = requireAtomicSleep();
  const onExit2 = onExitLeakFree;
  const ThreadStream = requireThreadStream();
  function setupOnExit(stream) {
    onExit2.register(stream, autoEnd2);
    onExit2.registerBeforeExit(stream, flush2);
    stream.on("close", function() {
      onExit2.unregister(stream);
    });
  }
  function buildStream(filename, workerData, workerOpts, sync) {
    const stream = new ThreadStream({
      filename,
      workerData,
      workerOpts,
      sync
    });
    stream.on("ready", onReady);
    stream.on("close", function() {
      process.removeListener("exit", onExit3);
    });
    process.on("exit", onExit3);
    function onReady() {
      process.removeListener("exit", onExit3);
      stream.unref();
      if (workerOpts.autoEnd !== false) {
        setupOnExit(stream);
      }
    }
    function onExit3() {
      if (stream.closed) {
        return;
      }
      stream.flushSync();
      sleep2(100);
      stream.end();
    }
    return stream;
  }
  function autoEnd2(stream) {
    stream.ref();
    stream.flushSync();
    stream.end();
    stream.once("close", function() {
      stream.unref();
    });
  }
  function flush2(stream) {
    stream.flushSync();
  }
  function transport2(fullOptions) {
    const { pipeline, targets, levels: levels2, dedupe, worker = {}, caller: caller2 = getCallers2(), sync = false } = fullOptions;
    const options = {
      ...fullOptions.options
    };
    const callers = typeof caller2 === "string" ? [caller2] : caller2;
    const bundlerOverrides = "__bundlerPathsOverrides" in globalThis ? globalThis.__bundlerPathsOverrides : {};
    let target = fullOptions.target;
    if (target && targets) {
      throw new Error("only one of target or targets can be specified");
    }
    if (targets) {
      target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
      options.targets = targets.filter((dest) => dest.target).map((dest) => {
        return {
          ...dest,
          target: fixTarget(dest.target)
        };
      });
      options.pipelines = targets.filter((dest) => dest.pipeline).map((dest) => {
        return dest.pipeline.map((t) => {
          return {
            ...t,
            level: dest.level,
            // duplicate the pipeline `level` property defined in the upper level
            target: fixTarget(t.target)
          };
        });
      });
    } else if (pipeline) {
      target = bundlerOverrides["pino-worker"] || join(__dirname, "worker.js");
      options.pipelines = [pipeline.map((dest) => {
        return {
          ...dest,
          target: fixTarget(dest.target)
        };
      })];
    }
    if (levels2) {
      options.levels = levels2;
    }
    if (dedupe) {
      options.dedupe = dedupe;
    }
    options.pinoWillSendConfig = true;
    return buildStream(fixTarget(target), options, worker, sync);
    function fixTarget(origin) {
      origin = bundlerOverrides[origin] || origin;
      if (isAbsolute(origin) || origin.indexOf("file://") === 0) {
        return origin;
      }
      if (origin === "pino/file") {
        return join(__dirname, "..", "file.js");
      }
      let fixTarget2;
      for (const filePath of callers) {
        try {
          const context = filePath === "node:repl" ? process.cwd() + sep : filePath;
          fixTarget2 = createRequire2(context).resolve(origin);
          break;
        } catch (err2) {
          continue;
        }
      }
      if (!fixTarget2) {
        throw new Error(`unable to determine transport target for "${origin}"`);
      }
      return fixTarget2;
    }
  }
  transport_1 = transport2;
  return transport_1;
}
const format = quickFormatUnescaped;
const { mapHttpRequest, mapHttpResponse } = pinoStdSerializers;
const SonicBoom = sonicBoom;
const onExit = onExitLeakFree;
const {
  lsCacheSym: lsCacheSym$2,
  chindingsSym: chindingsSym$2,
  writeSym: writeSym$1,
  serializersSym: serializersSym$2,
  formatOptsSym: formatOptsSym$2,
  endSym: endSym$1,
  stringifiersSym: stringifiersSym$2,
  stringifySym: stringifySym$2,
  stringifySafeSym: stringifySafeSym$1,
  wildcardFirstSym,
  nestedKeySym: nestedKeySym$1,
  formattersSym: formattersSym$3,
  messageKeySym: messageKeySym$2,
  errorKeySym: errorKeySym$2,
  nestedKeyStrSym: nestedKeyStrSym$1,
  msgPrefixSym: msgPrefixSym$2
} = symbols$1;
const { isMainThread } = require$$2;
const transport = requireTransport();
function noop$3() {
}
function genLog$1(level, hook) {
  if (!hook) return LOG;
  return function hookWrappedLog(...args) {
    hook.call(this, args, LOG, level);
  };
  function LOG(o, ...n) {
    if (typeof o === "object") {
      let msg = o;
      if (o !== null) {
        if (o.method && o.headers && o.socket) {
          o = mapHttpRequest(o);
        } else if (typeof o.setHeader === "function") {
          o = mapHttpResponse(o);
        }
      }
      let formatParams;
      if (msg === null && n.length === 0) {
        formatParams = [null];
      } else {
        msg = n.shift();
        formatParams = n;
      }
      if (typeof this[msgPrefixSym$2] === "string" && msg !== void 0 && msg !== null) {
        msg = this[msgPrefixSym$2] + msg;
      }
      this[writeSym$1](o, format(msg, formatParams, this[formatOptsSym$2]), level);
    } else {
      let msg = o === void 0 ? n.shift() : o;
      if (typeof this[msgPrefixSym$2] === "string" && msg !== void 0 && msg !== null) {
        msg = this[msgPrefixSym$2] + msg;
      }
      this[writeSym$1](null, format(msg, n, this[formatOptsSym$2]), level);
    }
  }
}
function asString(str) {
  let result = "";
  let last = 0;
  let found = false;
  let point = 255;
  const l = str.length;
  if (l > 100) {
    return JSON.stringify(str);
  }
  for (var i = 0; i < l && point >= 32; i++) {
    point = str.charCodeAt(i);
    if (point === 34 || point === 92) {
      result += str.slice(last, i) + "\\";
      last = i;
      found = true;
    }
  }
  if (!found) {
    result = str;
  } else {
    result += str.slice(last);
  }
  return point < 32 ? JSON.stringify(str) : '"' + result + '"';
}
function asJson$1(obj, msg, num, time2) {
  const stringify2 = this[stringifySym$2];
  const stringifySafe = this[stringifySafeSym$1];
  const stringifiers = this[stringifiersSym$2];
  const end = this[endSym$1];
  const chindings = this[chindingsSym$2];
  const serializers2 = this[serializersSym$2];
  const formatters = this[formattersSym$3];
  const messageKey = this[messageKeySym$2];
  const errorKey = this[errorKeySym$2];
  let data = this[lsCacheSym$2][num] + time2;
  data = data + chindings;
  let value;
  if (formatters.log) {
    obj = formatters.log(obj);
  }
  const wildcardStringifier = stringifiers[wildcardFirstSym];
  let propStr = "";
  for (const key in obj) {
    value = obj[key];
    if (Object.prototype.hasOwnProperty.call(obj, key) && value !== void 0) {
      if (serializers2[key]) {
        value = serializers2[key](value);
      } else if (key === errorKey && serializers2.err) {
        value = serializers2.err(value);
      }
      const stringifier = stringifiers[key] || wildcardStringifier;
      switch (typeof value) {
        case "undefined":
        case "function":
          continue;
        case "number":
          if (Number.isFinite(value) === false) {
            value = null;
          }
        case "boolean":
          if (stringifier) value = stringifier(value);
          break;
        case "string":
          value = (stringifier || asString)(value);
          break;
        default:
          value = (stringifier || stringify2)(value, stringifySafe);
      }
      if (value === void 0) continue;
      const strKey = asString(key);
      propStr += "," + strKey + ":" + value;
    }
  }
  let msgStr = "";
  if (msg !== void 0) {
    value = serializers2[messageKey] ? serializers2[messageKey](msg) : msg;
    const stringifier = stringifiers[messageKey] || wildcardStringifier;
    switch (typeof value) {
      case "function":
        break;
      case "number":
        if (Number.isFinite(value) === false) {
          value = null;
        }
      case "boolean":
        if (stringifier) value = stringifier(value);
        msgStr = ',"' + messageKey + '":' + value;
        break;
      case "string":
        value = (stringifier || asString)(value);
        msgStr = ',"' + messageKey + '":' + value;
        break;
      default:
        value = (stringifier || stringify2)(value, stringifySafe);
        msgStr = ',"' + messageKey + '":' + value;
    }
  }
  if (this[nestedKeySym$1] && propStr) {
    return data + this[nestedKeyStrSym$1] + propStr.slice(1) + "}" + msgStr + end;
  } else {
    return data + propStr + msgStr + end;
  }
}
function asChindings$2(instance, bindings2) {
  let value;
  let data = instance[chindingsSym$2];
  const stringify2 = instance[stringifySym$2];
  const stringifySafe = instance[stringifySafeSym$1];
  const stringifiers = instance[stringifiersSym$2];
  const wildcardStringifier = stringifiers[wildcardFirstSym];
  const serializers2 = instance[serializersSym$2];
  const formatter = instance[formattersSym$3].bindings;
  bindings2 = formatter(bindings2);
  for (const key in bindings2) {
    value = bindings2[key];
    const valid = key !== "level" && key !== "serializers" && key !== "formatters" && key !== "customLevels" && bindings2.hasOwnProperty(key) && value !== void 0;
    if (valid === true) {
      value = serializers2[key] ? serializers2[key](value) : value;
      value = (stringifiers[key] || wildcardStringifier || stringify2)(value, stringifySafe);
      if (value === void 0) continue;
      data += ',"' + key + '":' + value;
    }
  }
  return data;
}
function hasBeenTampered(stream) {
  return stream.write !== stream.constructor.prototype.write;
}
const hasNodeCodeCoverage = process.env.NODE_V8_COVERAGE || process.env.V8_COVERAGE;
function buildSafeSonicBoom$1(opts) {
  const stream = new SonicBoom(opts);
  stream.on("error", filterBrokenPipe);
  if (!hasNodeCodeCoverage && !opts.sync && isMainThread) {
    onExit.register(stream, autoEnd);
    stream.on("close", function() {
      onExit.unregister(stream);
    });
  }
  return stream;
  function filterBrokenPipe(err2) {
    if (err2.code === "EPIPE") {
      stream.write = noop$3;
      stream.end = noop$3;
      stream.flushSync = noop$3;
      stream.destroy = noop$3;
      return;
    }
    stream.removeListener("error", filterBrokenPipe);
    stream.emit("error", err2);
  }
}
function autoEnd(stream, eventName) {
  if (stream.destroyed) {
    return;
  }
  if (eventName === "beforeExit") {
    stream.flush();
    stream.on("drain", function() {
      stream.end();
    });
  } else {
    stream.flushSync();
  }
}
function createArgsNormalizer$1(defaultOptions2) {
  return function normalizeArgs(instance, caller2, opts = {}, stream) {
    if (typeof opts === "string") {
      stream = buildSafeSonicBoom$1({ dest: opts });
      opts = {};
    } else if (typeof stream === "string") {
      if (opts && opts.transport) {
        throw Error("only one of option.transport or stream can be specified");
      }
      stream = buildSafeSonicBoom$1({ dest: stream });
    } else if (opts instanceof SonicBoom || opts.writable || opts._writableState) {
      stream = opts;
      opts = {};
    } else if (opts.transport) {
      if (opts.transport instanceof SonicBoom || opts.transport.writable || opts.transport._writableState) {
        throw Error("option.transport do not allow stream, please pass to option directly. e.g. pino(transport)");
      }
      if (opts.transport.targets && opts.transport.targets.length && opts.formatters && typeof opts.formatters.level === "function") {
        throw Error("option.transport.targets do not allow custom level formatters");
      }
      let customLevels;
      if (opts.customLevels) {
        customLevels = opts.useOnlyCustomLevels ? opts.customLevels : Object.assign({}, opts.levels, opts.customLevels);
      }
      stream = transport({ caller: caller2, ...opts.transport, levels: customLevels });
    }
    opts = Object.assign({}, defaultOptions2, opts);
    opts.serializers = Object.assign({}, defaultOptions2.serializers, opts.serializers);
    opts.formatters = Object.assign({}, defaultOptions2.formatters, opts.formatters);
    if (opts.prettyPrint) {
      throw new Error("prettyPrint option is no longer supported, see the pino-pretty package (https://github.com/pinojs/pino-pretty)");
    }
    const { enabled, onChild } = opts;
    if (enabled === false) opts.level = "silent";
    if (!onChild) opts.onChild = noop$3;
    if (!stream) {
      if (!hasBeenTampered(process.stdout)) {
        stream = buildSafeSonicBoom$1({ fd: process.stdout.fd || 1 });
      } else {
        stream = process.stdout;
      }
    }
    return { opts, stream };
  };
}
function stringify$2(obj, stringifySafeFn) {
  try {
    return JSON.stringify(obj);
  } catch (_) {
    try {
      const stringify2 = stringifySafeFn || this[stringifySafeSym$1];
      return stringify2(obj);
    } catch (_2) {
      return '"[unable to serialize, circular reference is too complex to analyze]"';
    }
  }
}
function buildFormatters$2(level, bindings2, log) {
  return {
    level,
    bindings: bindings2,
    log
  };
}
function normalizeDestFileDescriptor$1(destination) {
  const fd = Number(destination);
  if (typeof destination === "string" && Number.isFinite(fd)) {
    return fd;
  }
  if (destination === void 0) {
    return 1;
  }
  return destination;
}
var tools = {
  noop: noop$3,
  buildSafeSonicBoom: buildSafeSonicBoom$1,
  asChindings: asChindings$2,
  asJson: asJson$1,
  genLog: genLog$1,
  createArgsNormalizer: createArgsNormalizer$1,
  stringify: stringify$2,
  buildFormatters: buildFormatters$2,
  normalizeDestFileDescriptor: normalizeDestFileDescriptor$1
};
const DEFAULT_LEVELS$2 = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
};
const SORTING_ORDER$2 = {
  ASC: "ASC",
  DESC: "DESC"
};
var constants = {
  DEFAULT_LEVELS: DEFAULT_LEVELS$2,
  SORTING_ORDER: SORTING_ORDER$2
};
const {
  lsCacheSym: lsCacheSym$1,
  levelValSym: levelValSym$1,
  useOnlyCustomLevelsSym: useOnlyCustomLevelsSym$2,
  streamSym: streamSym$2,
  formattersSym: formattersSym$2,
  hooksSym: hooksSym$1,
  levelCompSym: levelCompSym$1
} = symbols$1;
const { noop: noop$2, genLog } = tools;
const { DEFAULT_LEVELS: DEFAULT_LEVELS$1, SORTING_ORDER: SORTING_ORDER$1 } = constants;
const levelMethods = {
  fatal: (hook) => {
    const logFatal = genLog(DEFAULT_LEVELS$1.fatal, hook);
    return function(...args) {
      const stream = this[streamSym$2];
      logFatal.call(this, ...args);
      if (typeof stream.flushSync === "function") {
        try {
          stream.flushSync();
        } catch (e) {
        }
      }
    };
  },
  error: (hook) => genLog(DEFAULT_LEVELS$1.error, hook),
  warn: (hook) => genLog(DEFAULT_LEVELS$1.warn, hook),
  info: (hook) => genLog(DEFAULT_LEVELS$1.info, hook),
  debug: (hook) => genLog(DEFAULT_LEVELS$1.debug, hook),
  trace: (hook) => genLog(DEFAULT_LEVELS$1.trace, hook)
};
const nums = Object.keys(DEFAULT_LEVELS$1).reduce((o, k) => {
  o[DEFAULT_LEVELS$1[k]] = k;
  return o;
}, {});
const initialLsCache$1 = Object.keys(nums).reduce((o, k) => {
  o[k] = '{"level":' + Number(k);
  return o;
}, {});
function genLsCache$2(instance) {
  const formatter = instance[formattersSym$2].level;
  const { labels } = instance.levels;
  const cache = {};
  for (const label in labels) {
    const level = formatter(labels[label], Number(label));
    cache[label] = JSON.stringify(level).slice(0, -1);
  }
  instance[lsCacheSym$1] = cache;
  return instance;
}
function isStandardLevel(level, useOnlyCustomLevels) {
  if (useOnlyCustomLevels) {
    return false;
  }
  switch (level) {
    case "fatal":
    case "error":
    case "warn":
    case "info":
    case "debug":
    case "trace":
      return true;
    default:
      return false;
  }
}
function setLevel$1(level) {
  const { labels, values } = this.levels;
  if (typeof level === "number") {
    if (labels[level] === void 0) throw Error("unknown level value" + level);
    level = labels[level];
  }
  if (values[level] === void 0) throw Error("unknown level " + level);
  const preLevelVal = this[levelValSym$1];
  const levelVal = this[levelValSym$1] = values[level];
  const useOnlyCustomLevelsVal = this[useOnlyCustomLevelsSym$2];
  const levelComparison = this[levelCompSym$1];
  const hook = this[hooksSym$1].logMethod;
  for (const key in values) {
    if (levelComparison(values[key], levelVal) === false) {
      this[key] = noop$2;
      continue;
    }
    this[key] = isStandardLevel(key, useOnlyCustomLevelsVal) ? levelMethods[key](hook) : genLog(values[key], hook);
  }
  this.emit(
    "level-change",
    level,
    levelVal,
    labels[preLevelVal],
    preLevelVal,
    this
  );
}
function getLevel$1(level) {
  const { levels: levels2, levelVal } = this;
  return levels2 && levels2.labels ? levels2.labels[levelVal] : "";
}
function isLevelEnabled$1(logLevel) {
  const { values } = this.levels;
  const logLevelVal = values[logLevel];
  return logLevelVal !== void 0 && this[levelCompSym$1](logLevelVal, this[levelValSym$1]);
}
function compareLevel(direction, current, expected) {
  if (direction === SORTING_ORDER$1.DESC) {
    return current <= expected;
  }
  return current >= expected;
}
function genLevelComparison$1(levelComparison) {
  if (typeof levelComparison === "string") {
    return compareLevel.bind(null, levelComparison);
  }
  return levelComparison;
}
function mappings$2(customLevels = null, useOnlyCustomLevels = false) {
  const customNums = customLevels ? Object.keys(customLevels).reduce((o, k) => {
    o[customLevels[k]] = k;
    return o;
  }, {}) : null;
  const labels = Object.assign(
    Object.create(Object.prototype, { Infinity: { value: "silent" } }),
    useOnlyCustomLevels ? null : nums,
    customNums
  );
  const values = Object.assign(
    Object.create(Object.prototype, { silent: { value: Infinity } }),
    useOnlyCustomLevels ? null : DEFAULT_LEVELS$1,
    customLevels
  );
  return { labels, values };
}
function assertDefaultLevelFound$1(defaultLevel, customLevels, useOnlyCustomLevels) {
  if (typeof defaultLevel === "number") {
    const values = [].concat(
      Object.keys(customLevels || {}).map((key) => customLevels[key]),
      useOnlyCustomLevels ? [] : Object.keys(nums).map((level) => +level),
      Infinity
    );
    if (!values.includes(defaultLevel)) {
      throw Error(`default level:${defaultLevel} must be included in custom levels`);
    }
    return;
  }
  const labels = Object.assign(
    Object.create(Object.prototype, { silent: { value: Infinity } }),
    useOnlyCustomLevels ? null : DEFAULT_LEVELS$1,
    customLevels
  );
  if (!(defaultLevel in labels)) {
    throw Error(`default level:${defaultLevel} must be included in custom levels`);
  }
}
function assertNoLevelCollisions$1(levels2, customLevels) {
  const { labels, values } = levels2;
  for (const k in customLevels) {
    if (k in values) {
      throw Error("levels cannot be overridden");
    }
    if (customLevels[k] in labels) {
      throw Error("pre-existing level values cannot be used for new levels");
    }
  }
}
function assertLevelComparison$1(levelComparison) {
  if (typeof levelComparison === "function") {
    return;
  }
  if (typeof levelComparison === "string" && Object.values(SORTING_ORDER$1).includes(levelComparison)) {
    return;
  }
  throw new Error('Levels comparison should be one of "ASC", "DESC" or "function" type');
}
var levels = {
  initialLsCache: initialLsCache$1,
  genLsCache: genLsCache$2,
  levelMethods,
  getLevel: getLevel$1,
  setLevel: setLevel$1,
  isLevelEnabled: isLevelEnabled$1,
  mappings: mappings$2,
  assertNoLevelCollisions: assertNoLevelCollisions$1,
  assertDefaultLevelFound: assertDefaultLevelFound$1,
  genLevelComparison: genLevelComparison$1,
  assertLevelComparison: assertLevelComparison$1
};
var meta = { version: "9.5.0" };
const { EventEmitter } = require$$0$4;
const {
  lsCacheSym,
  levelValSym,
  setLevelSym: setLevelSym$1,
  getLevelSym,
  chindingsSym: chindingsSym$1,
  parsedChindingsSym,
  mixinSym: mixinSym$1,
  asJsonSym,
  writeSym,
  mixinMergeStrategySym: mixinMergeStrategySym$1,
  timeSym: timeSym$1,
  timeSliceIndexSym: timeSliceIndexSym$1,
  streamSym: streamSym$1,
  serializersSym: serializersSym$1,
  formattersSym: formattersSym$1,
  errorKeySym: errorKeySym$1,
  messageKeySym: messageKeySym$1,
  useOnlyCustomLevelsSym: useOnlyCustomLevelsSym$1,
  needsMetadataGsym,
  redactFmtSym: redactFmtSym$1,
  stringifySym: stringifySym$1,
  formatOptsSym: formatOptsSym$1,
  stringifiersSym: stringifiersSym$1,
  msgPrefixSym: msgPrefixSym$1
} = symbols$1;
const {
  getLevel,
  setLevel,
  isLevelEnabled,
  mappings: mappings$1,
  initialLsCache,
  genLsCache: genLsCache$1,
  assertNoLevelCollisions
} = levels;
const {
  asChindings: asChindings$1,
  asJson,
  buildFormatters: buildFormatters$1,
  stringify: stringify$1
} = tools;
const {
  version: version$1
} = meta;
const redaction$1 = redaction_1;
const constructor = class Pino {
};
const prototype = {
  constructor,
  child,
  bindings,
  setBindings,
  flush,
  isLevelEnabled,
  version: version$1,
  get level() {
    return this[getLevelSym]();
  },
  set level(lvl) {
    this[setLevelSym$1](lvl);
  },
  get levelVal() {
    return this[levelValSym];
  },
  set levelVal(n) {
    throw Error("levelVal is read-only");
  },
  [lsCacheSym]: initialLsCache,
  [writeSym]: write,
  [asJsonSym]: asJson,
  [getLevelSym]: getLevel,
  [setLevelSym$1]: setLevel
};
Object.setPrototypeOf(prototype, EventEmitter.prototype);
var proto$1 = function() {
  return Object.create(prototype);
};
const resetChildingsFormatter = (bindings2) => bindings2;
function child(bindings2, options) {
  if (!bindings2) {
    throw Error("missing bindings for child Pino");
  }
  options = options || {};
  const serializers2 = this[serializersSym$1];
  const formatters = this[formattersSym$1];
  const instance = Object.create(this);
  if (options.hasOwnProperty("serializers") === true) {
    instance[serializersSym$1] = /* @__PURE__ */ Object.create(null);
    for (const k in serializers2) {
      instance[serializersSym$1][k] = serializers2[k];
    }
    const parentSymbols = Object.getOwnPropertySymbols(serializers2);
    for (var i = 0; i < parentSymbols.length; i++) {
      const ks = parentSymbols[i];
      instance[serializersSym$1][ks] = serializers2[ks];
    }
    for (const bk in options.serializers) {
      instance[serializersSym$1][bk] = options.serializers[bk];
    }
    const bindingsSymbols = Object.getOwnPropertySymbols(options.serializers);
    for (var bi = 0; bi < bindingsSymbols.length; bi++) {
      const bks = bindingsSymbols[bi];
      instance[serializersSym$1][bks] = options.serializers[bks];
    }
  } else instance[serializersSym$1] = serializers2;
  if (options.hasOwnProperty("formatters")) {
    const { level, bindings: chindings, log } = options.formatters;
    instance[formattersSym$1] = buildFormatters$1(
      level || formatters.level,
      chindings || resetChildingsFormatter,
      log || formatters.log
    );
  } else {
    instance[formattersSym$1] = buildFormatters$1(
      formatters.level,
      resetChildingsFormatter,
      formatters.log
    );
  }
  if (options.hasOwnProperty("customLevels") === true) {
    assertNoLevelCollisions(this.levels, options.customLevels);
    instance.levels = mappings$1(options.customLevels, instance[useOnlyCustomLevelsSym$1]);
    genLsCache$1(instance);
  }
  if (typeof options.redact === "object" && options.redact !== null || Array.isArray(options.redact)) {
    instance.redact = options.redact;
    const stringifiers = redaction$1(instance.redact, stringify$1);
    const formatOpts = { stringify: stringifiers[redactFmtSym$1] };
    instance[stringifySym$1] = stringify$1;
    instance[stringifiersSym$1] = stringifiers;
    instance[formatOptsSym$1] = formatOpts;
  }
  if (typeof options.msgPrefix === "string") {
    instance[msgPrefixSym$1] = (this[msgPrefixSym$1] || "") + options.msgPrefix;
  }
  instance[chindingsSym$1] = asChindings$1(instance, bindings2);
  const childLevel = options.level || this.level;
  instance[setLevelSym$1](childLevel);
  this.onChild(instance);
  return instance;
}
function bindings() {
  const chindings = this[chindingsSym$1];
  const chindingsJson = `{${chindings.substr(1)}}`;
  const bindingsFromJson = JSON.parse(chindingsJson);
  delete bindingsFromJson.pid;
  delete bindingsFromJson.hostname;
  return bindingsFromJson;
}
function setBindings(newBindings) {
  const chindings = asChindings$1(this, newBindings);
  this[chindingsSym$1] = chindings;
  delete this[parsedChindingsSym];
}
function defaultMixinMergeStrategy(mergeObject, mixinObject) {
  return Object.assign(mixinObject, mergeObject);
}
function write(_obj, msg, num) {
  const t = this[timeSym$1]();
  const mixin = this[mixinSym$1];
  const errorKey = this[errorKeySym$1];
  const messageKey = this[messageKeySym$1];
  const mixinMergeStrategy = this[mixinMergeStrategySym$1] || defaultMixinMergeStrategy;
  let obj;
  if (_obj === void 0 || _obj === null) {
    obj = {};
  } else if (_obj instanceof Error) {
    obj = { [errorKey]: _obj };
    if (msg === void 0) {
      msg = _obj.message;
    }
  } else {
    obj = _obj;
    if (msg === void 0 && _obj[messageKey] === void 0 && _obj[errorKey]) {
      msg = _obj[errorKey].message;
    }
  }
  if (mixin) {
    obj = mixinMergeStrategy(obj, mixin(obj, num, this));
  }
  const s = this[asJsonSym](obj, msg, num, t);
  const stream = this[streamSym$1];
  if (stream[needsMetadataGsym] === true) {
    stream.lastLevel = num;
    stream.lastObj = obj;
    stream.lastMsg = msg;
    stream.lastTime = t.slice(this[timeSliceIndexSym$1]);
    stream.lastLogger = this;
  }
  stream.write(s);
}
function noop$1() {
}
function flush(cb) {
  if (cb != null && typeof cb !== "function") {
    throw Error("callback must be a function");
  }
  const stream = this[streamSym$1];
  if (typeof stream.flush === "function") {
    stream.flush(cb || noop$1);
  } else if (cb) cb();
}
var safeStableStringify = { exports: {} };
(function(module, exports) {
  const { hasOwnProperty } = Object.prototype;
  const stringify2 = configure2();
  stringify2.configure = configure2;
  stringify2.stringify = stringify2;
  stringify2.default = stringify2;
  exports.stringify = stringify2;
  exports.configure = configure2;
  module.exports = stringify2;
  const strEscapeSequencesRegExp = /[\u0000-\u001f\u0022\u005c\ud800-\udfff]/;
  function strEscape(str) {
    if (str.length < 5e3 && !strEscapeSequencesRegExp.test(str)) {
      return `"${str}"`;
    }
    return JSON.stringify(str);
  }
  function sort(array, comparator) {
    if (array.length > 200 || comparator) {
      return array.sort(comparator);
    }
    for (let i = 1; i < array.length; i++) {
      const currentValue = array[i];
      let position = i;
      while (position !== 0 && array[position - 1] > currentValue) {
        array[position] = array[position - 1];
        position--;
      }
      array[position] = currentValue;
    }
    return array;
  }
  const typedArrayPrototypeGetSymbolToStringTag = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(
      Object.getPrototypeOf(
        new Int8Array()
      )
    ),
    Symbol.toStringTag
  ).get;
  function isTypedArrayWithEntries(value) {
    return typedArrayPrototypeGetSymbolToStringTag.call(value) !== void 0 && value.length !== 0;
  }
  function stringifyTypedArray(array, separator, maximumBreadth) {
    if (array.length < maximumBreadth) {
      maximumBreadth = array.length;
    }
    const whitespace = separator === "," ? "" : " ";
    let res2 = `"0":${whitespace}${array[0]}`;
    for (let i = 1; i < maximumBreadth; i++) {
      res2 += `${separator}"${i}":${whitespace}${array[i]}`;
    }
    return res2;
  }
  function getCircularValueOption(options) {
    if (hasOwnProperty.call(options, "circularValue")) {
      const circularValue = options.circularValue;
      if (typeof circularValue === "string") {
        return `"${circularValue}"`;
      }
      if (circularValue == null) {
        return circularValue;
      }
      if (circularValue === Error || circularValue === TypeError) {
        return {
          toString() {
            throw new TypeError("Converting circular structure to JSON");
          }
        };
      }
      throw new TypeError('The "circularValue" argument must be of type string or the value null or undefined');
    }
    return '"[Circular]"';
  }
  function getDeterministicOption(options) {
    let value;
    if (hasOwnProperty.call(options, "deterministic")) {
      value = options.deterministic;
      if (typeof value !== "boolean" && typeof value !== "function") {
        throw new TypeError('The "deterministic" argument must be of type boolean or comparator function');
      }
    }
    return value === void 0 ? true : value;
  }
  function getBooleanOption(options, key) {
    let value;
    if (hasOwnProperty.call(options, key)) {
      value = options[key];
      if (typeof value !== "boolean") {
        throw new TypeError(`The "${key}" argument must be of type boolean`);
      }
    }
    return value === void 0 ? true : value;
  }
  function getPositiveIntegerOption(options, key) {
    let value;
    if (hasOwnProperty.call(options, key)) {
      value = options[key];
      if (typeof value !== "number") {
        throw new TypeError(`The "${key}" argument must be of type number`);
      }
      if (!Number.isInteger(value)) {
        throw new TypeError(`The "${key}" argument must be an integer`);
      }
      if (value < 1) {
        throw new RangeError(`The "${key}" argument must be >= 1`);
      }
    }
    return value === void 0 ? Infinity : value;
  }
  function getItemCount(number) {
    if (number === 1) {
      return "1 item";
    }
    return `${number} items`;
  }
  function getUniqueReplacerSet(replacerArray) {
    const replacerSet = /* @__PURE__ */ new Set();
    for (const value of replacerArray) {
      if (typeof value === "string" || typeof value === "number") {
        replacerSet.add(String(value));
      }
    }
    return replacerSet;
  }
  function getStrictOption(options) {
    if (hasOwnProperty.call(options, "strict")) {
      const value = options.strict;
      if (typeof value !== "boolean") {
        throw new TypeError('The "strict" argument must be of type boolean');
      }
      if (value) {
        return (value2) => {
          let message = `Object can not safely be stringified. Received type ${typeof value2}`;
          if (typeof value2 !== "function") message += ` (${value2.toString()})`;
          throw new Error(message);
        };
      }
    }
  }
  function configure2(options) {
    options = { ...options };
    const fail = getStrictOption(options);
    if (fail) {
      if (options.bigint === void 0) {
        options.bigint = false;
      }
      if (!("circularValue" in options)) {
        options.circularValue = Error;
      }
    }
    const circularValue = getCircularValueOption(options);
    const bigint = getBooleanOption(options, "bigint");
    const deterministic = getDeterministicOption(options);
    const comparator = typeof deterministic === "function" ? deterministic : void 0;
    const maximumDepth = getPositiveIntegerOption(options, "maximumDepth");
    const maximumBreadth = getPositiveIntegerOption(options, "maximumBreadth");
    function stringifyFnReplacer(key, parent, stack, replacer, spacer, indentation) {
      let value = parent[key];
      if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
        value = value.toJSON(key);
      }
      value = replacer.call(parent, key, value);
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          let res2 = "";
          let join = ",";
          const originalIndentation = indentation;
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            if (spacer !== "") {
              indentation += spacer;
              res2 += `
${indentation}`;
              join = `,
${indentation}`;
            }
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (; i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
              res2 += tmp2 !== void 0 ? tmp2 : "null";
              res2 += join;
            }
            const tmp = stringifyFnReplacer(String(i), value, stack, replacer, spacer, indentation);
            res2 += tmp !== void 0 ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res2 += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
            }
            if (spacer !== "") {
              res2 += `
${originalIndentation}`;
            }
            stack.pop();
            return `[${res2}]`;
          }
          let keys = Object.keys(value);
          const keyLength = keys.length;
          if (keyLength === 0) {
            return "{}";
          }
          if (maximumDepth < stack.length + 1) {
            return '"[Object]"';
          }
          let whitespace = "";
          let separator = "";
          if (spacer !== "") {
            indentation += spacer;
            join = `,
${indentation}`;
            whitespace = " ";
          }
          const maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
          if (deterministic && !isTypedArrayWithEntries(value)) {
            keys = sort(keys, comparator);
          }
          stack.push(value);
          for (let i = 0; i < maximumPropertiesToStringify; i++) {
            const key2 = keys[i];
            const tmp = stringifyFnReplacer(key2, value, stack, replacer, spacer, indentation);
            if (tmp !== void 0) {
              res2 += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
              separator = join;
            }
          }
          if (keyLength > maximumBreadth) {
            const removedKeys = keyLength - maximumBreadth;
            res2 += `${separator}"...":${whitespace}"${getItemCount(removedKeys)} not stringified"`;
            separator = join;
          }
          if (spacer !== "" && separator.length > 1) {
            res2 = `
${indentation}${res2}
${originalIndentation}`;
          }
          stack.pop();
          return `{${res2}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return void 0;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : void 0;
      }
    }
    function stringifyArrayReplacer(key, value, stack, replacer, spacer, indentation) {
      if (typeof value === "object" && value !== null && typeof value.toJSON === "function") {
        value = value.toJSON(key);
      }
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          const originalIndentation = indentation;
          let res2 = "";
          let join = ",";
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            if (spacer !== "") {
              indentation += spacer;
              res2 += `
${indentation}`;
              join = `,
${indentation}`;
            }
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (; i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
              res2 += tmp2 !== void 0 ? tmp2 : "null";
              res2 += join;
            }
            const tmp = stringifyArrayReplacer(String(i), value[i], stack, replacer, spacer, indentation);
            res2 += tmp !== void 0 ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res2 += `${join}"... ${getItemCount(removedKeys)} not stringified"`;
            }
            if (spacer !== "") {
              res2 += `
${originalIndentation}`;
            }
            stack.pop();
            return `[${res2}]`;
          }
          stack.push(value);
          let whitespace = "";
          if (spacer !== "") {
            indentation += spacer;
            join = `,
${indentation}`;
            whitespace = " ";
          }
          let separator = "";
          for (const key2 of replacer) {
            const tmp = stringifyArrayReplacer(key2, value[key2], stack, replacer, spacer, indentation);
            if (tmp !== void 0) {
              res2 += `${separator}${strEscape(key2)}:${whitespace}${tmp}`;
              separator = join;
            }
          }
          if (spacer !== "" && separator.length > 1) {
            res2 = `
${indentation}${res2}
${originalIndentation}`;
          }
          stack.pop();
          return `{${res2}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return void 0;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : void 0;
      }
    }
    function stringifyIndent(key, value, stack, spacer, indentation) {
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (typeof value.toJSON === "function") {
            value = value.toJSON(key);
            if (typeof value !== "object") {
              return stringifyIndent(key, value, stack, spacer, indentation);
            }
            if (value === null) {
              return "null";
            }
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          const originalIndentation = indentation;
          if (Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            indentation += spacer;
            let res3 = `
${indentation}`;
            const join2 = `,
${indentation}`;
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (; i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifyIndent(String(i), value[i], stack, spacer, indentation);
              res3 += tmp2 !== void 0 ? tmp2 : "null";
              res3 += join2;
            }
            const tmp = stringifyIndent(String(i), value[i], stack, spacer, indentation);
            res3 += tmp !== void 0 ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res3 += `${join2}"... ${getItemCount(removedKeys)} not stringified"`;
            }
            res3 += `
${originalIndentation}`;
            stack.pop();
            return `[${res3}]`;
          }
          let keys = Object.keys(value);
          const keyLength = keys.length;
          if (keyLength === 0) {
            return "{}";
          }
          if (maximumDepth < stack.length + 1) {
            return '"[Object]"';
          }
          indentation += spacer;
          const join = `,
${indentation}`;
          let res2 = "";
          let separator = "";
          let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
          if (isTypedArrayWithEntries(value)) {
            res2 += stringifyTypedArray(value, join, maximumBreadth);
            keys = keys.slice(value.length);
            maximumPropertiesToStringify -= value.length;
            separator = join;
          }
          if (deterministic) {
            keys = sort(keys, comparator);
          }
          stack.push(value);
          for (let i = 0; i < maximumPropertiesToStringify; i++) {
            const key2 = keys[i];
            const tmp = stringifyIndent(key2, value[key2], stack, spacer, indentation);
            if (tmp !== void 0) {
              res2 += `${separator}${strEscape(key2)}: ${tmp}`;
              separator = join;
            }
          }
          if (keyLength > maximumBreadth) {
            const removedKeys = keyLength - maximumBreadth;
            res2 += `${separator}"...": "${getItemCount(removedKeys)} not stringified"`;
            separator = join;
          }
          if (separator !== "") {
            res2 = `
${indentation}${res2}
${originalIndentation}`;
          }
          stack.pop();
          return `{${res2}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return void 0;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : void 0;
      }
    }
    function stringifySimple(key, value, stack) {
      switch (typeof value) {
        case "string":
          return strEscape(value);
        case "object": {
          if (value === null) {
            return "null";
          }
          if (typeof value.toJSON === "function") {
            value = value.toJSON(key);
            if (typeof value !== "object") {
              return stringifySimple(key, value, stack);
            }
            if (value === null) {
              return "null";
            }
          }
          if (stack.indexOf(value) !== -1) {
            return circularValue;
          }
          let res2 = "";
          const hasLength = value.length !== void 0;
          if (hasLength && Array.isArray(value)) {
            if (value.length === 0) {
              return "[]";
            }
            if (maximumDepth < stack.length + 1) {
              return '"[Array]"';
            }
            stack.push(value);
            const maximumValuesToStringify = Math.min(value.length, maximumBreadth);
            let i = 0;
            for (; i < maximumValuesToStringify - 1; i++) {
              const tmp2 = stringifySimple(String(i), value[i], stack);
              res2 += tmp2 !== void 0 ? tmp2 : "null";
              res2 += ",";
            }
            const tmp = stringifySimple(String(i), value[i], stack);
            res2 += tmp !== void 0 ? tmp : "null";
            if (value.length - 1 > maximumBreadth) {
              const removedKeys = value.length - maximumBreadth - 1;
              res2 += `,"... ${getItemCount(removedKeys)} not stringified"`;
            }
            stack.pop();
            return `[${res2}]`;
          }
          let keys = Object.keys(value);
          const keyLength = keys.length;
          if (keyLength === 0) {
            return "{}";
          }
          if (maximumDepth < stack.length + 1) {
            return '"[Object]"';
          }
          let separator = "";
          let maximumPropertiesToStringify = Math.min(keyLength, maximumBreadth);
          if (hasLength && isTypedArrayWithEntries(value)) {
            res2 += stringifyTypedArray(value, ",", maximumBreadth);
            keys = keys.slice(value.length);
            maximumPropertiesToStringify -= value.length;
            separator = ",";
          }
          if (deterministic) {
            keys = sort(keys, comparator);
          }
          stack.push(value);
          for (let i = 0; i < maximumPropertiesToStringify; i++) {
            const key2 = keys[i];
            const tmp = stringifySimple(key2, value[key2], stack);
            if (tmp !== void 0) {
              res2 += `${separator}${strEscape(key2)}:${tmp}`;
              separator = ",";
            }
          }
          if (keyLength > maximumBreadth) {
            const removedKeys = keyLength - maximumBreadth;
            res2 += `${separator}"...":"${getItemCount(removedKeys)} not stringified"`;
          }
          stack.pop();
          return `{${res2}}`;
        }
        case "number":
          return isFinite(value) ? String(value) : fail ? fail(value) : "null";
        case "boolean":
          return value === true ? "true" : "false";
        case "undefined":
          return void 0;
        case "bigint":
          if (bigint) {
            return String(value);
          }
        default:
          return fail ? fail(value) : void 0;
      }
    }
    function stringify3(value, replacer, space) {
      if (arguments.length > 1) {
        let spacer = "";
        if (typeof space === "number") {
          spacer = " ".repeat(Math.min(space, 10));
        } else if (typeof space === "string") {
          spacer = space.slice(0, 10);
        }
        if (replacer != null) {
          if (typeof replacer === "function") {
            return stringifyFnReplacer("", { "": value }, [], replacer, spacer, "");
          }
          if (Array.isArray(replacer)) {
            return stringifyArrayReplacer("", value, [], getUniqueReplacerSet(replacer), spacer, "");
          }
        }
        if (spacer.length !== 0) {
          return stringifyIndent("", value, [], spacer, "");
        }
      }
      return stringifySimple("", value, []);
    }
    return stringify3;
  }
})(safeStableStringify, safeStableStringify.exports);
var safeStableStringifyExports = safeStableStringify.exports;
var multistream_1;
var hasRequiredMultistream;
function requireMultistream() {
  if (hasRequiredMultistream) return multistream_1;
  hasRequiredMultistream = 1;
  const metadata = Symbol.for("pino.metadata");
  const { DEFAULT_LEVELS: DEFAULT_LEVELS2 } = constants;
  const DEFAULT_INFO_LEVEL = DEFAULT_LEVELS2.info;
  function multistream(streamsArray, opts) {
    let counter = 0;
    streamsArray = streamsArray || [];
    opts = opts || { dedupe: false };
    const streamLevels = Object.create(DEFAULT_LEVELS2);
    streamLevels.silent = Infinity;
    if (opts.levels && typeof opts.levels === "object") {
      Object.keys(opts.levels).forEach((i) => {
        streamLevels[i] = opts.levels[i];
      });
    }
    const res2 = {
      write: write2,
      add,
      emit,
      flushSync: flushSync2,
      end,
      minLevel: 0,
      streams: [],
      clone,
      [metadata]: true,
      streamLevels
    };
    if (Array.isArray(streamsArray)) {
      streamsArray.forEach(add, res2);
    } else {
      add.call(res2, streamsArray);
    }
    streamsArray = null;
    return res2;
    function write2(data) {
      let dest;
      const level = this.lastLevel;
      const { streams } = this;
      let recordedLevel = 0;
      let stream;
      for (let i = initLoopVar(streams.length, opts.dedupe); checkLoopVar(i, streams.length, opts.dedupe); i = adjustLoopVar(i, opts.dedupe)) {
        dest = streams[i];
        if (dest.level <= level) {
          if (recordedLevel !== 0 && recordedLevel !== dest.level) {
            break;
          }
          stream = dest.stream;
          if (stream[metadata]) {
            const { lastTime, lastMsg, lastObj, lastLogger } = this;
            stream.lastLevel = level;
            stream.lastTime = lastTime;
            stream.lastMsg = lastMsg;
            stream.lastObj = lastObj;
            stream.lastLogger = lastLogger;
          }
          stream.write(data);
          if (opts.dedupe) {
            recordedLevel = dest.level;
          }
        } else if (!opts.dedupe) {
          break;
        }
      }
    }
    function emit(...args) {
      for (const { stream } of this.streams) {
        if (typeof stream.emit === "function") {
          stream.emit(...args);
        }
      }
    }
    function flushSync2() {
      for (const { stream } of this.streams) {
        if (typeof stream.flushSync === "function") {
          stream.flushSync();
        }
      }
    }
    function add(dest) {
      if (!dest) {
        return res2;
      }
      const isStream = typeof dest.write === "function" || dest.stream;
      const stream_ = dest.write ? dest : dest.stream;
      if (!isStream) {
        throw Error("stream object needs to implement either StreamEntry or DestinationStream interface");
      }
      const { streams, streamLevels: streamLevels2 } = this;
      let level;
      if (typeof dest.levelVal === "number") {
        level = dest.levelVal;
      } else if (typeof dest.level === "string") {
        level = streamLevels2[dest.level];
      } else if (typeof dest.level === "number") {
        level = dest.level;
      } else {
        level = DEFAULT_INFO_LEVEL;
      }
      const dest_ = {
        stream: stream_,
        level,
        levelVal: void 0,
        id: counter++
      };
      streams.unshift(dest_);
      streams.sort(compareByLevel);
      this.minLevel = streams[0].level;
      return res2;
    }
    function end() {
      for (const { stream } of this.streams) {
        if (typeof stream.flushSync === "function") {
          stream.flushSync();
        }
        stream.end();
      }
    }
    function clone(level) {
      const streams = new Array(this.streams.length);
      for (let i = 0; i < streams.length; i++) {
        streams[i] = {
          level,
          stream: this.streams[i].stream
        };
      }
      return {
        write: write2,
        add,
        minLevel: level,
        streams,
        clone,
        emit,
        flushSync: flushSync2,
        [metadata]: true
      };
    }
  }
  function compareByLevel(a, b) {
    return a.level - b.level;
  }
  function initLoopVar(length, dedupe) {
    return dedupe ? length - 1 : 0;
  }
  function adjustLoopVar(i, dedupe) {
    return dedupe ? i - 1 : i + 1;
  }
  function checkLoopVar(i, length, dedupe) {
    return dedupe ? i >= 0 : i < length;
  }
  multistream_1 = multistream;
  return multistream_1;
}
const os = require$$0$5;
const stdSerializers = pinoStdSerializers;
const caller = caller$1;
const redaction = redaction_1;
const time = time$1;
const proto = proto$1;
const symbols = symbols$1;
const { configure } = safeStableStringifyExports;
const { assertDefaultLevelFound, mappings, genLsCache, genLevelComparison, assertLevelComparison } = levels;
const { DEFAULT_LEVELS, SORTING_ORDER } = constants;
const {
  createArgsNormalizer,
  asChindings,
  buildSafeSonicBoom,
  buildFormatters,
  stringify,
  normalizeDestFileDescriptor,
  noop
} = tools;
const { version } = meta;
const {
  chindingsSym,
  redactFmtSym,
  serializersSym,
  timeSym,
  timeSliceIndexSym,
  streamSym,
  stringifySym,
  stringifySafeSym,
  stringifiersSym,
  setLevelSym,
  endSym,
  formatOptsSym,
  messageKeySym,
  errorKeySym,
  nestedKeySym,
  mixinSym,
  levelCompSym,
  useOnlyCustomLevelsSym,
  formattersSym,
  hooksSym,
  nestedKeyStrSym,
  mixinMergeStrategySym,
  msgPrefixSym
} = symbols;
const { epochTime, nullTime } = time;
const { pid } = process;
const hostname = os.hostname();
const defaultErrorSerializer = stdSerializers.err;
const defaultOptions = {
  level: "info",
  levelComparison: SORTING_ORDER.ASC,
  levels: DEFAULT_LEVELS,
  messageKey: "msg",
  errorKey: "err",
  nestedKey: null,
  enabled: true,
  base: { pid, hostname },
  serializers: Object.assign(/* @__PURE__ */ Object.create(null), {
    err: defaultErrorSerializer
  }),
  formatters: Object.assign(/* @__PURE__ */ Object.create(null), {
    bindings(bindings2) {
      return bindings2;
    },
    level(label, number) {
      return { level: number };
    }
  }),
  hooks: {
    logMethod: void 0
  },
  timestamp: epochTime,
  name: void 0,
  redact: null,
  customLevels: null,
  useOnlyCustomLevels: false,
  depthLimit: 5,
  edgeLimit: 100
};
const normalize = createArgsNormalizer(defaultOptions);
const serializers = Object.assign(/* @__PURE__ */ Object.create(null), stdSerializers);
function pino(...args) {
  const instance = {};
  const { opts, stream } = normalize(instance, caller(), ...args);
  if (opts.level && typeof opts.level === "string" && DEFAULT_LEVELS[opts.level.toLowerCase()] !== void 0) opts.level = opts.level.toLowerCase();
  const {
    redact,
    crlf,
    serializers: serializers2,
    timestamp,
    messageKey,
    errorKey,
    nestedKey,
    base,
    name: name2,
    level,
    customLevels,
    levelComparison,
    mixin,
    mixinMergeStrategy,
    useOnlyCustomLevels,
    formatters,
    hooks,
    depthLimit,
    edgeLimit,
    onChild,
    msgPrefix
  } = opts;
  const stringifySafe = configure({
    maximumDepth: depthLimit,
    maximumBreadth: edgeLimit
  });
  const allFormatters = buildFormatters(
    formatters.level,
    formatters.bindings,
    formatters.log
  );
  const stringifyFn = stringify.bind({
    [stringifySafeSym]: stringifySafe
  });
  const stringifiers = redact ? redaction(redact, stringifyFn) : {};
  const formatOpts = redact ? { stringify: stringifiers[redactFmtSym] } : { stringify: stringifyFn };
  const end = "}" + (crlf ? "\r\n" : "\n");
  const coreChindings = asChindings.bind(null, {
    [chindingsSym]: "",
    [serializersSym]: serializers2,
    [stringifiersSym]: stringifiers,
    [stringifySym]: stringify,
    [stringifySafeSym]: stringifySafe,
    [formattersSym]: allFormatters
  });
  let chindings = "";
  if (base !== null) {
    if (name2 === void 0) {
      chindings = coreChindings(base);
    } else {
      chindings = coreChindings(Object.assign({}, base, { name: name2 }));
    }
  }
  const time2 = timestamp instanceof Function ? timestamp : timestamp ? epochTime : nullTime;
  const timeSliceIndex = time2().indexOf(":") + 1;
  if (useOnlyCustomLevels && !customLevels) throw Error("customLevels is required if useOnlyCustomLevels is set true");
  if (mixin && typeof mixin !== "function") throw Error(`Unknown mixin type "${typeof mixin}" - expected "function"`);
  if (msgPrefix && typeof msgPrefix !== "string") throw Error(`Unknown msgPrefix type "${typeof msgPrefix}" - expected "string"`);
  assertDefaultLevelFound(level, customLevels, useOnlyCustomLevels);
  const levels2 = mappings(customLevels, useOnlyCustomLevels);
  if (typeof stream.emit === "function") {
    stream.emit("message", { code: "PINO_CONFIG", config: { levels: levels2, messageKey, errorKey } });
  }
  assertLevelComparison(levelComparison);
  const levelCompFunc = genLevelComparison(levelComparison);
  Object.assign(instance, {
    levels: levels2,
    [levelCompSym]: levelCompFunc,
    [useOnlyCustomLevelsSym]: useOnlyCustomLevels,
    [streamSym]: stream,
    [timeSym]: time2,
    [timeSliceIndexSym]: timeSliceIndex,
    [stringifySym]: stringify,
    [stringifySafeSym]: stringifySafe,
    [stringifiersSym]: stringifiers,
    [endSym]: end,
    [formatOptsSym]: formatOpts,
    [messageKeySym]: messageKey,
    [errorKeySym]: errorKey,
    [nestedKeySym]: nestedKey,
    // protect against injection
    [nestedKeyStrSym]: nestedKey ? `,${JSON.stringify(nestedKey)}:{` : "",
    [serializersSym]: serializers2,
    [mixinSym]: mixin,
    [mixinMergeStrategySym]: mixinMergeStrategy,
    [chindingsSym]: chindings,
    [formattersSym]: allFormatters,
    [hooksSym]: hooks,
    silent: noop,
    onChild,
    [msgPrefixSym]: msgPrefix
  });
  Object.setPrototypeOf(instance, proto());
  genLsCache(instance);
  instance[setLevelSym](level);
  return instance;
}
pino$2.exports = pino;
pino$2.exports.destination = (dest = process.stdout.fd) => {
  if (typeof dest === "object") {
    dest.dest = normalizeDestFileDescriptor(dest.dest || process.stdout.fd);
    return buildSafeSonicBoom(dest);
  } else {
    return buildSafeSonicBoom({ dest: normalizeDestFileDescriptor(dest), minLength: 0 });
  }
};
pino$2.exports.transport = requireTransport();
pino$2.exports.multistream = requireMultistream();
pino$2.exports.levels = mappings();
pino$2.exports.stdSerializers = serializers;
pino$2.exports.stdTimeFunctions = Object.assign({}, time);
pino$2.exports.symbols = symbols;
pino$2.exports.version = version;
pino$2.exports.default = pino;
pino$2.exports.pino = pino;
var pinoExports = pino$2.exports;
const pino$1 = /* @__PURE__ */ getDefaultExportFromCjs(pinoExports);
const logger = pino$1({ level: "silent" });
ipcMain.handle("selectSong", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "Select song",
      filters: [{ name: "Audio files", extensions: ["mp3", "flac"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  } catch (err2) {
    console.error("Error selecting files: ", err2);
    throw err2;
  }
});
ipcMain.handle(
  "getSongBuffer",
  async (event, songPath) => {
    logger.info(`executing getSong(${songPath}) handler`);
    logger.trace(`reading file ${songPath}`);
    const song = await readFile(songPath);
    if (song) {
      logger.info(`getSong(${songPath}) has returned the song successfully`);
      return song;
    } else {
      logger.info(`getSong(${songPath}) has failed`);
      return void 0;
    }
  }
);
ipcMain.handle(
  "getSongMetadata",
  async (event, songPath) => {
    logger.info(`executing getSongMetadata(${songPath})`);
    let nodeStream;
    let songStream;
    nodeStream = createReadStream(songPath);
    nodeStream.on("open", async (fd) => {
    });
    nodeStream.on("error", (error) => {
    });
    nodeStream.on("data", (chunk) => {
    });
    nodeStream.on("end", () => {
    });
    songStream = new ReadableStream({
      type: "bytes",
      start(controller) {
        nodeStream.on("data", (chunk) => {
          controller.enqueue(chunk);
        });
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (error) => controller.error(error));
      },
      cancel() {
        nodeStream.destroy();
      }
    });
    const songMetadata = await parseWebStream(
      songStream,
      {
        mimeType: "audio"
      },
      {
        observer: (update) => {
          if (update.metadata.common.title && update.metadata.common.album && update.metadata.common.picture && update.metadata.common.year && update.metadata.common.artist && update.metadata.common.albumartist && update.metadata.common.genre && update.metadata.format.duration && update.metadata.format.container) {
            songStream.cancel();
          }
        }
      }
    );
    if (songMetadata != void 0) {
      const _songMetadata = new SongMetadata();
      if (songMetadata.common.title != void 0) {
        _songMetadata.title = songMetadata.common.title;
      } else {
        _songMetadata.title = basename(songPath, extname(songPath));
      }
      _songMetadata.album = songMetadata.common.album;
      if (songMetadata.common.picture != void 0) {
        _songMetadata.frontCover = uint8ArrayToBase64(
          songMetadata.common.picture[0].data
        );
      }
      _songMetadata.year = songMetadata.common.year;
      _songMetadata.artist = songMetadata.common.artist;
      _songMetadata.albumArtist = songMetadata.common.albumartist;
      _songMetadata.genre = songMetadata.common.genre;
      _songMetadata.duration = songMetadata.format.duration;
      _songMetadata.itemType = songMetadata.format.container;
      _songMetadata.format = songMetadata.format.container;
      logger.info(
        `getSongMetadata(${songPath}) returned ${inspect(_songMetadata, {
          breakLength: Infinity,
          maxArrayLength: 2,
          maxStringLength: 50
        })}`
      );
      return _songMetadata;
    }
    return null;
  }
);
createRequire(import.meta.url);
const __dirname$1 = path$1.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path$1.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path$1.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path$1.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path$1.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    darkTheme: false,
    titleBarOverlay: {
      color: "#f9f9f9",
      height: 32
    },
    minWidth: 174,
    minHeight: 500,
    frame: false,
    titleBarStyle: "hidden",
    icon: path$1.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path$1.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path$1.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  createWindow();
  win == null ? void 0 : win.setTitleBarOverlay({
    color: nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#f9f9f9",
    symbolColor: "#808080",
    height: 32
  });
  nativeTheme.on("updated", () => {
    win == null ? void 0 : win.setTitleBarOverlay({
      color: nativeTheme.shouldUseDarkColors ? "#1f1f1f" : "#f9f9f9",
      symbolColor: "#909090",
      height: 32
    });
  });
});
export {
  AttachedPictureType as A,
  BasicParser as B,
  INT24_BE as C,
  uint8ArrayToString as D,
  EndOfStreamError as E,
  FourCcToken as F,
  Token as G,
  Genres as H,
  INT16_BE as I,
  APEv2Parser as J,
  ID3v2Header as K,
  ID3v1Parser as L,
  trimRightNull as M,
  UINT24_LE as N,
  TextEncodingToken as O,
  findZero as P,
  TextHeader as Q,
  SyncTextHeader as R,
  StringType as S,
  TrackType as T,
  UINT32_BE as U,
  ExtendedHeader as V,
  UINT32SYNCSAFE as W,
  AnsiStringType as X,
  VITE_DEV_SERVER_URL as Y,
  MAIN_DIST as Z,
  RENDERER_DIST as _,
  UINT8 as a,
  UINT16_BE as b,
  initDebug as c,
  Uint8ArrayType as d,
  decodeString as e,
  UINT32_LE as f,
  getBitAllignedNumber as g,
  hexToUint8Array as h,
  isBitSet$1 as i,
  UINT64_LE as j,
  UINT16_LE as k,
  getBit as l,
  makeUnexpectedFileContentError as m,
  INT64_BE as n,
  fromBuffer as o,
  INT64_LE as p,
  INT32_LE as q,
  UINT24_BE as r,
  stripNulls as s,
  Float64_BE as t,
  uint8ArrayToHex as u,
  Float32_BE as v,
  UINT64_BE as w,
  TargetType as x,
  INT32_BE as y,
  INT8 as z
};
