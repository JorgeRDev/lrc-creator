import { c as initDebug, F as FourCcToken, d as Uint8ArrayType, l as getBit, g as getBitAllignedNumber, r as UINT24_BE, b as UINT16_BE, m as makeUnexpectedFileContentError } from "./main-CNxT3up2.js";
import { V as VorbisParser, a as VorbisPictureToken, b as VorbisDecoder } from "./VorbisParser-DgC0g80R.js";
import { A as AbstractID3Parser } from "./AbstractID3Parser-DHQ15Vfs.js";
const debug = initDebug("music-metadata:parser:FLAC");
class FlacContentError extends makeUnexpectedFileContentError("FLAC") {
}
var BlockType;
(function(BlockType2) {
  BlockType2[BlockType2["STREAMINFO"] = 0] = "STREAMINFO";
  BlockType2[BlockType2["PADDING"] = 1] = "PADDING";
  BlockType2[BlockType2["APPLICATION"] = 2] = "APPLICATION";
  BlockType2[BlockType2["SEEKTABLE"] = 3] = "SEEKTABLE";
  BlockType2[BlockType2["VORBIS_COMMENT"] = 4] = "VORBIS_COMMENT";
  BlockType2[BlockType2["CUESHEET"] = 5] = "CUESHEET";
  BlockType2[BlockType2["PICTURE"] = 6] = "PICTURE";
})(BlockType || (BlockType = {}));
class FlacParser extends AbstractID3Parser {
  constructor() {
    super(...arguments);
    this.vorbisParser = new VorbisParser(this.metadata, this.options);
    this.padding = 0;
  }
  async postId3v2Parse() {
    const fourCC = await this.tokenizer.readToken(FourCcToken);
    if (fourCC.toString() !== "fLaC") {
      throw new FlacContentError("Invalid FLAC preamble");
    }
    let blockHeader;
    do {
      blockHeader = await this.tokenizer.readToken(BlockHeader);
      await this.parseDataBlock(blockHeader);
    } while (!blockHeader.lastBlock);
    if (this.tokenizer.fileInfo.size && this.metadata.format.duration) {
      const dataSize = this.tokenizer.fileInfo.size - this.tokenizer.position;
      this.metadata.setFormat("bitrate", 8 * dataSize / this.metadata.format.duration);
    }
  }
  async parseDataBlock(blockHeader) {
    debug(`blockHeader type=${blockHeader.type}, length=${blockHeader.length}`);
    switch (blockHeader.type) {
      case BlockType.STREAMINFO:
        return this.parseBlockStreamInfo(blockHeader.length);
      case BlockType.PADDING:
        this.padding += blockHeader.length;
        break;
      case BlockType.APPLICATION:
        break;
      case BlockType.SEEKTABLE:
        break;
      case BlockType.VORBIS_COMMENT:
        return this.parseComment(blockHeader.length);
      case BlockType.CUESHEET:
        break;
      case BlockType.PICTURE:
        await this.parsePicture(blockHeader.length);
        return;
      default:
        this.metadata.addWarning(`Unknown block type: ${blockHeader.type}`);
    }
    return this.tokenizer.ignore(blockHeader.length).then();
  }
  /**
   * Parse STREAMINFO
   */
  async parseBlockStreamInfo(dataLen) {
    if (dataLen !== BlockStreamInfo.len)
      throw new FlacContentError("Unexpected block-stream-info length");
    const streamInfo = await this.tokenizer.readToken(BlockStreamInfo);
    this.metadata.setFormat("container", "FLAC");
    this.metadata.setFormat("codec", "FLAC");
    this.metadata.setFormat("lossless", true);
    this.metadata.setFormat("numberOfChannels", streamInfo.channels);
    this.metadata.setFormat("bitsPerSample", streamInfo.bitsPerSample);
    this.metadata.setFormat("sampleRate", streamInfo.sampleRate);
    if (streamInfo.totalSamples > 0) {
      this.metadata.setFormat("duration", streamInfo.totalSamples / streamInfo.sampleRate);
    }
  }
  /**
   * Parse VORBIS_COMMENT
   * Ref: https://www.xiph.org/vorbis/doc/Vorbis_I_spec.html#x1-640004.2.3
   */
  async parseComment(dataLen) {
    const data = await this.tokenizer.readToken(new Uint8ArrayType(dataLen));
    const decoder = new VorbisDecoder(data, 0);
    decoder.readStringUtf8();
    const commentListLength = decoder.readInt32();
    const tags = new Array(commentListLength);
    for (let i = 0; i < commentListLength; i++) {
      tags[i] = decoder.parseUserComment();
    }
    await Promise.all(tags.map((tag) => this.vorbisParser.addTag(tag.key, tag.value)));
  }
  async parsePicture(dataLen) {
    if (this.options.skipCovers) {
      return this.tokenizer.ignore(dataLen);
    }
    const picture = await this.tokenizer.readToken(new VorbisPictureToken(dataLen));
    this.vorbisParser.addTag("METADATA_BLOCK_PICTURE", picture);
  }
}
const BlockHeader = {
  len: 4,
  get: (buf, off) => {
    return {
      lastBlock: getBit(buf, off, 7),
      type: getBitAllignedNumber(buf, off, 1, 7),
      length: UINT24_BE.get(buf, off + 1)
    };
  }
};
const BlockStreamInfo = {
  len: 34,
  get: (buf, off) => {
    return {
      // The minimum block size (in samples) used in the stream.
      minimumBlockSize: UINT16_BE.get(buf, off),
      // The maximum block size (in samples) used in the stream.
      // (Minimum blocksize == maximum blocksize) implies a fixed-blocksize stream.
      maximumBlockSize: UINT16_BE.get(buf, off + 2) / 1e3,
      // The minimum frame size (in bytes) used in the stream.
      // May be 0 to imply the value is not known.
      minimumFrameSize: UINT24_BE.get(buf, off + 4),
      // The maximum frame size (in bytes) used in the stream.
      // May be 0 to imply the value is not known.
      maximumFrameSize: UINT24_BE.get(buf, off + 7),
      // Sample rate in Hz. Though 20 bits are available,
      // the maximum sample rate is limited by the structure of frame headers to 655350Hz.
      // Also, a value of 0 is invalid.
      sampleRate: UINT24_BE.get(buf, off + 10) >> 4,
      // probably slower: sampleRate: common.getBitAllignedNumber(buf, off + 10, 0, 20),
      // (number of channels)-1. FLAC supports from 1 to 8 channels
      channels: getBitAllignedNumber(buf, off + 12, 4, 3) + 1,
      // bits per sample)-1.
      // FLAC supports from 4 to 32 bits per sample. Currently the reference encoder and decoders only support up to 24 bits per sample.
      bitsPerSample: getBitAllignedNumber(buf, off + 12, 7, 5) + 1,
      // Total samples in stream.
      // 'Samples' means inter-channel sample, i.e. one second of 44.1Khz audio will have 44100 samples regardless of the number of channels.
      // A value of zero here means the number of total samples is unknown.
      totalSamples: getBitAllignedNumber(buf, off + 13, 4, 36),
      // the MD5 hash of the file (see notes for usage... it's a littly tricky)
      fileMD5: new Uint8ArrayType(16).get(buf, off + 18)
    };
  }
};
export {
  FlacParser
};
