import { Howl } from "howler"
import pino, { Logger } from "pino"
import Song from "./song"

const logger: Logger<never, boolean> = pino({ level: "silent" })

export default class ActualSong extends Song {
  song: Howl | undefined
  actualDuration: number | undefined

  getActualDuration(): number | undefined {
    if (this.song === undefined) {
      return undefined
    }

    return this.actualDuration
  }

  setActualDuration(duration: number) {
    if (this.song === undefined) {
      return
    }

    this.song.seek(duration)
    this.actualDuration = duration
  }

  async loadSong(songPath: SongPath) {
    logger.info(`loading song ${songPath}`)
    this.disposeAll()

    logger.trace(`setting songPath to ${songPath}`)
    this.songPath = songPath
    logger.trace(`setting buffer`)
    await this.createBuffer()
    logger.trace(`creating blob from buffer`)
    this.createBlobFromBuffer()
    logger.trace(`creating url from blob`)
    this.createURLFromBlob()

    if (this.url === undefined) {
      throw new Error(
        "URL is undefined. Try calling createURLFromBlob() first before loading the song"
      )
    }

    logger.trace(`creating metadata from buffer`)
    await this.getMetadataFromSongPath()

    logger.trace(`creating howl with ${this.url} without autoplay`)
    this.song = new Howl({
      src: [this.url],
      html5: true,
      format: this.songMetadata?.format,
      loop: true,
      onplay: () => {
        setInterval(() => {
          this.actualDuration = this.song?.seek()
        }, 1000)
      },
    })

    logger.trace(`creating front cover url`)
    await this.createFrontCoverBlob()
    logger.trace(`creating front cover blob`)
    await this.createFrontCoverURL()
  }

  async isPlaying(): Promise<boolean> {
    if (this.song === undefined) {
      return false
    }

    return this.song.playing()
  }

  async pause() {
    logger.info(`pausing song`)
    if (this.song === undefined) {
      throw new Error("Song is undefined. Try calling loadSong() first")
    }

    try {
      this.song.pause()
    } catch (error) {
      logger.error(`error pausing song: ${error}`)
    }
  }

  async play() {
    if (this.song === undefined) {
      throw new Error("Song is undefined. Try calling loadSong() first")
    }

    try {
      this.song.play()
    } catch (error) {
      logger.error(`error playing song: ${error}`)
    }
  }

  disposeAll(): void {
    logger.info(`executing disposeAll()`)
    logger.trace(`disposing blob and buffer`)

    this.disposeBlobAndBuffer()

    if (this.songMetadata) {
      this.songMetadata = undefined
    }

    if (this.frontCoverURL) {
      URL.revokeObjectURL(this.frontCoverURL)
      this.frontCoverURL = undefined
    }

    if (this.frontCoverBlob) {
      this.frontCoverBlob = undefined
    }

    if (this.song) {
      this.song.unload()
      this.song = undefined
    }
  }
}
