import { F as FourCcToken, j as UINT64_LE, p as INT64_LE, q as INT32_LE, c as initDebug, m as makeUnexpectedFileContentError } from "./main-CNxT3up2.js";
import { A as AbstractID3Parser } from "./AbstractID3Parser-DHQ15Vfs.js";
import { I as ID3v2Parser } from "./ID3v2Parser-DOAs3Y6s.js";
const ChunkHeader = {
  len: 12,
  get: (buf, off) => {
    return { id: FourCcToken.get(buf, off), size: UINT64_LE.get(buf, off + 4) };
  }
};
const DsdChunk = {
  len: 16,
  get: (buf, off) => {
    return {
      fileSize: INT64_LE.get(buf, off),
      metadataPointer: INT64_LE.get(buf, off + 8)
    };
  }
};
var ChannelType;
(function(ChannelType2) {
  ChannelType2[ChannelType2["mono"] = 1] = "mono";
  ChannelType2[ChannelType2["stereo"] = 2] = "stereo";
  ChannelType2[ChannelType2["channels"] = 3] = "channels";
  ChannelType2[ChannelType2["quad"] = 4] = "quad";
  ChannelType2[ChannelType2["4 channels"] = 5] = "4 channels";
  ChannelType2[ChannelType2["5 channels"] = 6] = "5 channels";
  ChannelType2[ChannelType2["5.1 channels"] = 7] = "5.1 channels";
})(ChannelType || (ChannelType = {}));
const FormatChunk = {
  len: 40,
  get: (buf, off) => {
    return {
      formatVersion: INT32_LE.get(buf, off),
      formatID: INT32_LE.get(buf, off + 4),
      channelType: INT32_LE.get(buf, off + 8),
      channelNum: INT32_LE.get(buf, off + 12),
      samplingFrequency: INT32_LE.get(buf, off + 16),
      bitsPerSample: INT32_LE.get(buf, off + 20),
      sampleCount: INT64_LE.get(buf, off + 24),
      blockSizePerChannel: INT32_LE.get(buf, off + 32)
    };
  }
};
const debug = initDebug("music-metadata:parser:DSF");
class DsdContentParseError extends makeUnexpectedFileContentError("DSD") {
}
class DsfParser extends AbstractID3Parser {
  async postId3v2Parse() {
    const p0 = this.tokenizer.position;
    const chunkHeader = await this.tokenizer.readToken(ChunkHeader);
    if (chunkHeader.id !== "DSD ")
      throw new DsdContentParseError("Invalid chunk signature");
    this.metadata.setFormat("container", "DSF");
    this.metadata.setFormat("lossless", true);
    const dsdChunk = await this.tokenizer.readToken(DsdChunk);
    if (dsdChunk.metadataPointer === BigInt(0)) {
      debug("No ID3v2 tag present");
    } else {
      debug(`expect ID3v2 at offset=${dsdChunk.metadataPointer}`);
      await this.parseChunks(dsdChunk.fileSize - chunkHeader.size);
      await this.tokenizer.ignore(Number(dsdChunk.metadataPointer) - this.tokenizer.position - p0);
      return new ID3v2Parser().parse(this.metadata, this.tokenizer, this.options);
    }
  }
  async parseChunks(bytesRemaining) {
    while (bytesRemaining >= ChunkHeader.len) {
      const chunkHeader = await this.tokenizer.readToken(ChunkHeader);
      debug(`Parsing chunk name=${chunkHeader.id} size=${chunkHeader.size}`);
      switch (chunkHeader.id) {
        case "fmt ": {
          const formatChunk = await this.tokenizer.readToken(FormatChunk);
          this.metadata.setFormat("numberOfChannels", formatChunk.channelNum);
          this.metadata.setFormat("sampleRate", formatChunk.samplingFrequency);
          this.metadata.setFormat("bitsPerSample", formatChunk.bitsPerSample);
          this.metadata.setFormat("numberOfSamples", formatChunk.sampleCount);
          this.metadata.setFormat("duration", Number(formatChunk.sampleCount) / formatChunk.samplingFrequency);
          const bitrate = formatChunk.bitsPerSample * formatChunk.samplingFrequency * formatChunk.channelNum;
          this.metadata.setFormat("bitrate", bitrate);
          return;
        }
        default:
          this.tokenizer.ignore(Number(chunkHeader.size) - ChunkHeader.len);
          break;
      }
      bytesRemaining -= chunkHeader.size;
    }
  }
}
export {
  DsdContentParseError,
  DsfParser
};
