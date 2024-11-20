import { g as getBitAllignedNumber, c as initDebug, B as BasicParser, X as AnsiStringType } from "./main-CNxT3up2.js";
const FrameHeader = {
  len: 1,
  get: (buf, off) => {
    return {
      frameType: getBitAllignedNumber(buf, off, 1, 4)
    };
  }
};
const debug = initDebug("music-metadata:parser:AMR");
const m_block_size = [12, 13, 15, 17, 19, 20, 26, 31, 5, 0, 0, 0, 0, 0, 0, 0];
class AmrParser extends BasicParser {
  async parse() {
    var _a;
    const magicNr = await this.tokenizer.readToken(new AnsiStringType(5));
    if (magicNr !== "#!AMR") {
      throw new Error("Invalid AMR file: invalid MAGIC number");
    }
    this.metadata.setFormat("container", "AMR");
    this.metadata.setFormat("codec", "AMR");
    this.metadata.setFormat("sampleRate", 8e3);
    this.metadata.setFormat("bitrate", 64e3);
    this.metadata.setFormat("numberOfChannels", 1);
    let total_size = 0;
    let frames = 0;
    const assumedFileLength = ((_a = this.tokenizer.fileInfo) == null ? void 0 : _a.size) ?? Number.MAX_SAFE_INTEGER;
    if (this.options.duration) {
      while (this.tokenizer.position < assumedFileLength) {
        const header = await this.tokenizer.readToken(FrameHeader);
        const size = m_block_size[header.frameType];
        if (size > 0) {
          total_size += size + 1;
          if (total_size > assumedFileLength)
            break;
          await this.tokenizer.ignore(size);
          ++frames;
        } else {
          debug(`Found no-data frame, frame-type: ${header.frameType}. Skipping`);
        }
      }
      this.metadata.setFormat("duration", frames * 0.02);
    }
  }
}
export {
  AmrParser
};
