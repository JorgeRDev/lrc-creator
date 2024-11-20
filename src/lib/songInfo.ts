import Song from "./song"
import pino, { Logger } from "pino"

const logger: Logger<never, boolean> = pino({ level: "silent" })

class SongInfo extends Song {
  constructor(songPath: SongPath) {
    logger.info(`SongInfo() has been created with ${songPath}`)
    super()
    this.songPath = songPath
  }

  async init() {
    await this.getMetadataFromSongPath()
    await this.createFrontCoverBlob()
    await this.createFrontCoverURL()
  }
}

export { SongInfo }
