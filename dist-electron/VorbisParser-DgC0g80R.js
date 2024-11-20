import { A as AttachedPictureType, U as UINT32_BE, S as StringType, a as UINT8, f as UINT32_LE, c as initDebug, m as makeUnexpectedFileContentError } from "./main-CNxT3up2.js";
class VorbisPictureToken {
  static fromBase64(base64str) {
    return VorbisPictureToken.fromBuffer(Uint8Array.from(atob(base64str), (c) => c.charCodeAt(0)));
  }
  static fromBuffer(buffer) {
    const pic = new VorbisPictureToken(buffer.length);
    return pic.get(buffer, 0);
  }
  constructor(len) {
    this.len = len;
  }
  get(buffer, offset) {
    const type = AttachedPictureType[UINT32_BE.get(buffer, offset)];
    offset += 4;
    const mimeLen = UINT32_BE.get(buffer, offset);
    offset += 4;
    const format = new StringType(mimeLen, "utf-8").get(buffer, offset);
    offset += mimeLen;
    const descLen = UINT32_BE.get(buffer, offset);
    offset += 4;
    const description = new StringType(descLen, "utf-8").get(buffer, offset);
    offset += descLen;
    const width = UINT32_BE.get(buffer, offset);
    offset += 4;
    const height = UINT32_BE.get(buffer, offset);
    offset += 4;
    const colour_depth = UINT32_BE.get(buffer, offset);
    offset += 4;
    const indexed_color = UINT32_BE.get(buffer, offset);
    offset += 4;
    const picDataLen = UINT32_BE.get(buffer, offset);
    offset += 4;
    const data = Uint8Array.from(buffer.slice(offset, offset + picDataLen));
    return {
      type,
      format,
      description,
      width,
      height,
      colour_depth,
      indexed_color,
      data
    };
  }
}
const CommonHeader = {
  len: 7,
  get: (buf, off) => {
    return {
      packetType: UINT8.get(buf, off),
      vorbis: new StringType(6, "ascii").get(buf, off + 1)
    };
  }
};
const IdentificationHeader = {
  len: 23,
  get: (uint8Array, off) => {
    return {
      version: UINT32_LE.get(uint8Array, off + 0),
      channelMode: UINT8.get(uint8Array, off + 4),
      sampleRate: UINT32_LE.get(uint8Array, off + 5),
      bitrateMax: UINT32_LE.get(uint8Array, off + 9),
      bitrateNominal: UINT32_LE.get(uint8Array, off + 13),
      bitrateMin: UINT32_LE.get(uint8Array, off + 17)
    };
  }
};
class VorbisDecoder {
  constructor(data, offset) {
    this.data = data;
    this.offset = offset;
  }
  readInt32() {
    const value = UINT32_LE.get(this.data, this.offset);
    this.offset += 4;
    return value;
  }
  readStringUtf8() {
    const len = this.readInt32();
    const value = new TextDecoder("utf-8").decode(this.data.subarray(this.offset, this.offset + len));
    this.offset += len;
    return value;
  }
  parseUserComment() {
    const offset0 = this.offset;
    const v = this.readStringUtf8();
    const idx = v.indexOf("=");
    return {
      key: v.slice(0, idx).toUpperCase(),
      value: v.slice(idx + 1),
      len: this.offset - offset0
    };
  }
}
const debug = initDebug("music-metadata:parser:ogg:vorbis1");
class VorbisContentError extends makeUnexpectedFileContentError("Vorbis") {
}
class VorbisParser {
  constructor(metadata, options) {
    this.metadata = metadata;
    this.options = options;
    this.pageSegments = [];
  }
  /**
   * Vorbis 1 parser
   * @param header Ogg Page Header
   * @param pageData Page data
   */
  async parsePage(header, pageData) {
    if (header.headerType.firstPage) {
      this.parseFirstPage(header, pageData);
    } else {
      if (header.headerType.continued) {
        if (this.pageSegments.length === 0) {
          throw new VorbisContentError("Cannot continue on previous page");
        }
        this.pageSegments.push(pageData);
      }
      if (header.headerType.lastPage || !header.headerType.continued) {
        if (this.pageSegments.length > 0) {
          const fullPage = VorbisParser.mergeUint8Arrays(this.pageSegments);
          await this.parseFullPage(fullPage);
        }
        this.pageSegments = header.headerType.lastPage ? [] : [pageData];
      }
    }
    if (header.headerType.lastPage) {
      this.calculateDuration(header);
    }
  }
  static mergeUint8Arrays(arrays) {
    const totalSize = arrays.reduce((acc, e) => acc + e.length, 0);
    const merged = new Uint8Array(totalSize);
    arrays.forEach((array, i, _arrays) => {
      const offset = _arrays.slice(0, i).reduce((acc, e) => acc + e.length, 0);
      merged.set(array, offset);
    });
    return merged;
  }
  async flush() {
    await this.parseFullPage(VorbisParser.mergeUint8Arrays(this.pageSegments));
  }
  async parseUserComment(pageData, offset) {
    const decoder = new VorbisDecoder(pageData, offset);
    const tag = decoder.parseUserComment();
    await this.addTag(tag.key, tag.value);
    return tag.len;
  }
  async addTag(id, value) {
    if (id === "METADATA_BLOCK_PICTURE" && typeof value === "string") {
      if (this.options.skipCovers) {
        debug("Ignore picture");
        return;
      }
      value = VorbisPictureToken.fromBase64(value);
      debug(`Push picture: id=${id}, format=${value.format}`);
    } else {
      debug(`Push tag: id=${id}, value=${value}`);
    }
    await this.metadata.addTag("vorbis", id, value);
  }
  calculateDuration(header) {
    if (this.metadata.format.sampleRate && header.absoluteGranulePosition >= 0) {
      this.metadata.setFormat("numberOfSamples", header.absoluteGranulePosition);
      this.metadata.setFormat("duration", header.absoluteGranulePosition / this.metadata.format.sampleRate);
    }
  }
  /**
   * Parse first Ogg/Vorbis page
   * @param header
   * @param pageData
   */
  parseFirstPage(header, pageData) {
    this.metadata.setFormat("codec", "Vorbis I");
    debug("Parse first page");
    const commonHeader = CommonHeader.get(pageData, 0);
    if (commonHeader.vorbis !== "vorbis")
      throw new VorbisContentError("Metadata does not look like Vorbis");
    if (commonHeader.packetType === 1) {
      const idHeader = IdentificationHeader.get(pageData, CommonHeader.len);
      this.metadata.setFormat("sampleRate", idHeader.sampleRate);
      this.metadata.setFormat("bitrate", idHeader.bitrateNominal);
      this.metadata.setFormat("numberOfChannels", idHeader.channelMode);
      debug("sample-rate=%s[hz], bitrate=%s[b/s], channel-mode=%s", idHeader.sampleRate, idHeader.bitrateNominal, idHeader.channelMode);
    } else
      throw new VorbisContentError("First Ogg page should be type 1: the identification header");
  }
  async parseFullPage(pageData) {
    const commonHeader = CommonHeader.get(pageData, 0);
    debug("Parse full page: type=%s, byteLength=%s", commonHeader.packetType, pageData.byteLength);
    switch (commonHeader.packetType) {
      case 3:
        return this.parseUserCommentList(pageData, CommonHeader.len);
    }
  }
  /**
   * Ref: https://xiph.org/vorbis/doc/Vorbis_I_spec.html#x1-840005.2
   */
  async parseUserCommentList(pageData, offset) {
    const strLen = UINT32_LE.get(pageData, offset);
    offset += 4;
    offset += strLen;
    let userCommentListLength = UINT32_LE.get(pageData, offset);
    offset += 4;
    while (userCommentListLength-- > 0) {
      offset += await this.parseUserComment(pageData, offset);
    }
  }
}
export {
  VorbisParser as V,
  VorbisPictureToken as a,
  VorbisDecoder as b
};
