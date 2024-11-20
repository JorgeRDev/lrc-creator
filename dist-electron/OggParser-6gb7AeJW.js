import { m as makeUnexpectedFileContentError, S as StringType, a as UINT8, k as UINT16_LE, f as UINT32_LE, M as trimRightNull, q as INT32_LE, c as initDebug, b as UINT16_BE, r as UINT24_BE, B as BasicParser, d as Uint8ArrayType, E as EndOfStreamError, F as FourCcToken, l as getBit, j as UINT64_LE } from "./main-CNxT3up2.js";
import "node:fs/promises";
import { V as VorbisParser } from "./VorbisParser-DgC0g80R.js";
class OpusContentError extends makeUnexpectedFileContentError("Opus") {
}
class IdHeader {
  constructor(len) {
    this.len = len;
    if (len < 19) {
      throw new OpusContentError("ID-header-page 0 should be at least 19 bytes long");
    }
  }
  get(buf, off) {
    return {
      magicSignature: new StringType(8, "ascii").get(buf, off + 0),
      version: UINT8.get(buf, off + 8),
      channelCount: UINT8.get(buf, off + 9),
      preSkip: UINT16_LE.get(buf, off + 10),
      inputSampleRate: UINT32_LE.get(buf, off + 12),
      outputGain: UINT16_LE.get(buf, off + 16),
      channelMapping: UINT8.get(buf, off + 18)
    };
  }
}
class OpusParser extends VorbisParser {
  constructor(metadata, options, tokenizer) {
    super(metadata, options);
    this.tokenizer = tokenizer;
    this.idHeader = null;
    this.lastPos = -1;
  }
  /**
   * Parse first Opus Ogg page
   * @param {IPageHeader} header
   * @param {Uint8Array} pageData
   */
  parseFirstPage(header, pageData) {
    this.metadata.setFormat("codec", "Opus");
    this.idHeader = new IdHeader(pageData.length).get(pageData, 0);
    if (this.idHeader.magicSignature !== "OpusHead")
      throw new OpusContentError("Illegal ogg/Opus magic-signature");
    this.metadata.setFormat("sampleRate", this.idHeader.inputSampleRate);
    this.metadata.setFormat("numberOfChannels", this.idHeader.channelCount);
  }
  async parseFullPage(pageData) {
    const magicSignature = new StringType(8, "ascii").get(pageData, 0);
    switch (magicSignature) {
      case "OpusTags":
        await this.parseUserCommentList(pageData, 8);
        this.lastPos = this.tokenizer.position - pageData.length;
        break;
    }
  }
  calculateDuration(header) {
    if (this.metadata.format.sampleRate && header.absoluteGranulePosition >= 0) {
      const pos_48bit = header.absoluteGranulePosition - this.idHeader.preSkip;
      this.metadata.setFormat("numberOfSamples", pos_48bit);
      this.metadata.setFormat("duration", pos_48bit / 48e3);
      if (this.lastPos !== -1 && this.tokenizer.fileInfo.size && this.metadata.format.duration) {
        const dataSize = this.tokenizer.fileInfo.size - this.lastPos;
        this.metadata.setFormat("bitrate", 8 * dataSize / this.metadata.format.duration);
      }
    }
  }
}
const Header = {
  len: 80,
  get: (buf, off) => {
    return {
      speex: new StringType(8, "ascii").get(buf, off + 0),
      version: trimRightNull(new StringType(20, "ascii").get(buf, off + 8)),
      version_id: INT32_LE.get(buf, off + 28),
      header_size: INT32_LE.get(buf, off + 32),
      rate: INT32_LE.get(buf, off + 36),
      mode: INT32_LE.get(buf, off + 40),
      mode_bitstream_version: INT32_LE.get(buf, off + 44),
      nb_channels: INT32_LE.get(buf, off + 48),
      bitrate: INT32_LE.get(buf, off + 52),
      frame_size: INT32_LE.get(buf, off + 56),
      vbr: INT32_LE.get(buf, off + 60),
      frames_per_packet: INT32_LE.get(buf, off + 64),
      extra_headers: INT32_LE.get(buf, off + 68),
      reserved1: INT32_LE.get(buf, off + 72),
      reserved2: INT32_LE.get(buf, off + 76)
    };
  }
};
const debug$2 = initDebug("music-metadata:parser:ogg:speex");
class SpeexParser extends VorbisParser {
  constructor(metadata, options, tokenizer) {
    super(metadata, options);
    this.tokenizer = tokenizer;
  }
  /**
   * Parse first Speex Ogg page
   * @param {IPageHeader} header
   * @param {Uint8Array} pageData
   */
  parseFirstPage(header, pageData) {
    debug$2("First Ogg/Speex page");
    const speexHeader = Header.get(pageData, 0);
    this.metadata.setFormat("codec", `Speex ${speexHeader.version}`);
    this.metadata.setFormat("numberOfChannels", speexHeader.nb_channels);
    this.metadata.setFormat("sampleRate", speexHeader.rate);
    if (speexHeader.bitrate !== -1) {
      this.metadata.setFormat("bitrate", speexHeader.bitrate);
    }
  }
}
const IdentificationHeader = {
  len: 42,
  get: (buf, off) => {
    return {
      id: new StringType(7, "ascii").get(buf, off),
      vmaj: UINT8.get(buf, off + 7),
      vmin: UINT8.get(buf, off + 8),
      vrev: UINT8.get(buf, off + 9),
      vmbw: UINT16_BE.get(buf, off + 10),
      vmbh: UINT16_BE.get(buf, off + 17),
      nombr: UINT24_BE.get(buf, off + 37),
      nqual: UINT8.get(buf, off + 40)
    };
  }
};
const debug$1 = initDebug("music-metadata:parser:ogg:theora");
class TheoraParser {
  constructor(metadata, options, tokenizer) {
    this.metadata = metadata;
    this.tokenizer = tokenizer;
  }
  /**
   * Vorbis 1 parser
   * @param header Ogg Page Header
   * @param pageData Page data
   */
  async parsePage(header, pageData) {
    if (header.headerType.firstPage) {
      await this.parseFirstPage(header, pageData);
    }
  }
  async flush() {
    debug$1("flush");
  }
  calculateDuration(header) {
    debug$1("duration calculation not implemented");
  }
  /**
   * Parse first Theora Ogg page. the initial identification header packet
   * @param {IPageHeader} header
   * @param {Buffer} pageData
   */
  async parseFirstPage(header, pageData) {
    debug$1("First Ogg/Theora page");
    this.metadata.setFormat("codec", "Theora");
    const idHeader = IdentificationHeader.get(pageData, 0);
    this.metadata.setFormat("bitrate", idHeader.nombr);
  }
}
class OggContentError extends makeUnexpectedFileContentError("Ogg") {
}
const debug = initDebug("music-metadata:parser:ogg");
class SegmentTable {
  static sum(buf, off, len) {
    const dv = new DataView(buf.buffer, 0);
    let s = 0;
    for (let i = off; i < off + len; ++i) {
      s += dv.getUint8(i);
    }
    return s;
  }
  constructor(header) {
    this.len = header.page_segments;
  }
  get(buf, off) {
    return {
      totalPageSize: SegmentTable.sum(buf, off, this.len)
    };
  }
}
class OggParser extends BasicParser {
  constructor() {
    super(...arguments);
    this.header = null;
    this.pageNumber = 0;
    this.pageConsumer = null;
  }
  /**
   * Parse page
   * @returns {Promise<void>}
   */
  async parse() {
    debug("pos=%s, parsePage()", this.tokenizer.position);
    try {
      let header;
      do {
        header = await this.tokenizer.readToken(OggParser.Header);
        if (header.capturePattern !== "OggS")
          throw new OggContentError("Invalid Ogg capture pattern");
        this.metadata.setFormat("container", "Ogg");
        this.header = header;
        this.pageNumber = header.pageSequenceNo;
        debug("page#=%s, Ogg.id=%s", header.pageSequenceNo, header.capturePattern);
        const segmentTable = await this.tokenizer.readToken(new SegmentTable(header));
        debug("totalPageSize=%s", segmentTable.totalPageSize);
        const pageData = await this.tokenizer.readToken(new Uint8ArrayType(segmentTable.totalPageSize));
        debug("firstPage=%s, lastPage=%s, continued=%s", header.headerType.firstPage, header.headerType.lastPage, header.headerType.continued);
        if (header.headerType.firstPage) {
          const id = new TextDecoder("ascii").decode(pageData.subarray(0, 7));
          switch (id) {
            case "vorbis":
              debug("Set page consumer to Ogg/Vorbis");
              this.pageConsumer = new VorbisParser(this.metadata, this.options);
              break;
            case "OpusHea":
              debug("Set page consumer to Ogg/Opus");
              this.pageConsumer = new OpusParser(this.metadata, this.options, this.tokenizer);
              break;
            case "Speex  ":
              debug("Set page consumer to Ogg/Speex");
              this.pageConsumer = new SpeexParser(this.metadata, this.options, this.tokenizer);
              break;
            case "fishead":
            case "\0theora":
              debug("Set page consumer to Ogg/Theora");
              this.pageConsumer = new TheoraParser(this.metadata, this.options, this.tokenizer);
              break;
            default:
              throw new OggContentError(`gg audio-codec not recognized (id=${id})`);
          }
        }
        await this.pageConsumer.parsePage(header, pageData);
      } while (!header.headerType.lastPage);
    } catch (err) {
      if (err instanceof Error) {
        if (err instanceof EndOfStreamError) {
          this.metadata.addWarning("Last OGG-page is not marked with last-page flag");
          debug("End-of-stream");
          this.metadata.addWarning("Last OGG-page is not marked with last-page flag");
          if (this.header) {
            this.pageConsumer.calculateDuration(this.header);
          }
        } else if (err.message.startsWith("FourCC")) {
          if (this.pageNumber > 0) {
            this.metadata.addWarning("Invalid FourCC ID, maybe last OGG-page is not marked with last-page flag");
            await this.pageConsumer.flush();
          }
        }
      } else
        throw err;
    }
  }
}
OggParser.Header = {
  len: 27,
  get: (buf, off) => {
    return {
      capturePattern: FourCcToken.get(buf, off),
      version: UINT8.get(buf, off + 4),
      headerType: {
        continued: getBit(buf, off + 5, 0),
        firstPage: getBit(buf, off + 5, 1),
        lastPage: getBit(buf, off + 5, 2)
      },
      // packet_flag: Token.UINT8.get(buf, off + 5),
      absoluteGranulePosition: Number(UINT64_LE.get(buf, off + 6)),
      streamSerialNumber: UINT32_LE.get(buf, off + 14),
      pageSequenceNo: UINT32_LE.get(buf, off + 18),
      pageChecksum: UINT32_LE.get(buf, off + 22),
      page_segments: UINT8.get(buf, off + 26)
    };
  }
};
export {
  OggContentError,
  OggParser,
  SegmentTable
};
