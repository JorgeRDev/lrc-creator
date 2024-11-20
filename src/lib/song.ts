import pino from "pino"
import { base64ToUint8Array } from "uint8array-extras"
import SongMetadata from "../../lib/songMetadata"

const logger = pino({ level: "silent" })

/**
 * Base class that contains all the necessary properties and methods to represent songs.
 * This class serves as a foundation for subclasses that need to handle song-related functionality,
 * such as currently playing songs or song information display.
 * It manages song data like buffers, blobs, metadata and cover art.
 */

export default class Song {
  songPath: SongPath | undefined
  buffer: Buffer | undefined
  blob: Blob | undefined
  url: string | undefined
  songMetadata: SongMetadata | undefined
  totalDuration: number | undefined
  frontCoverBlob: Blob | undefined
  frontCoverURL: string | undefined

  /**
   * Creates a buffer from the song path stored in this instance
   * @returns {Promise<Buffer>} A buffer containing the song data, or undefined if the song cannot be loaded
   * @throws {Error} If songPath is undefined
   */
  async createBuffer(): Promise<void> {
    logger.info("executing createBuffer()")
    logger.trace(`creating buffer from ${this.songPath}`)
    /**
     * Creates a buffer from the song path stored in this instance
     * @returns {Promise<Buffer|undefined>} A buffer containing the song data, or undefined if the song cannot be loaded
     * @throws {Error} If songPath is undefined
     */
    let _buffer: Buffer | undefined

    try {
      _buffer = await window.App.MusicManager.getSongBuffer(this.songPath)
    } catch (err) {
      throw err
    }

    if (_buffer === undefined) {
      throw new Error("Buffer is undefined")
    }

    this.buffer = _buffer
  }

  createBlobFromBuffer() {
    logger.info(`executing createBlobFromBuffer()`)
    logger.trace(`creating blob from buffer`)

    if (this.buffer === undefined) {
      throw new Error(
        "Buffer is undefined. Try calling createBuffer() first before creating a blob"
      )
    }

    this.blob = new Blob([this.buffer])
  }

  createURLFromBlob() {
    logger.info(`executing createURLFromBlob()`)
    logger.trace(`creating url from blob`)

    if (this.blob === undefined) {
      throw new Error(
        "Blob is undefined. Try calling createBlobFromBuffer() first before creating a url"
      )
    }

    this.url = URL.createObjectURL(this.blob)
  }

  async getMetadataFromSongPath() {
    logger.info(`executing getMetadataFromSongPath()`)
    logger.trace(`getting metadata from song path`)

    if (this.songPath === undefined) {
      throw new Error(
        "Song path is undefined. Try setting the songPath first before getting metadata"
      )
    }

    this.songMetadata = await window.App.MusicManager.getSongMetadata(
      this.songPath
    )

    this.setTotalDuration(this.songMetadata?.duration ?? 0)
  }

  async createFrontCoverBlob() {
    logger.info(`executing createFrontCoverBlob()`)
    logger.trace(`creating front cover blob`)

    if (this.songMetadata === undefined) {
      throw new Error(
        "Song metadata is undefined. Try calling getMetadataFromSongPath() first before creating a front cover blob"
      )
    }

    if (this.songMetadata.frontCover === undefined) {
      return undefined
    }

    this.frontCoverBlob = new Blob([
      base64ToUint8Array(this.songMetadata.frontCover),
    ])
  }

  async createFrontCoverURL() {
    logger.info(`executing createFrontCoverURL()`)
    logger.trace(`creating front cover url`)

    if (this.frontCoverBlob === undefined) {
      return undefined
    }

    this.frontCoverURL = URL.createObjectURL(this.frontCoverBlob)
  }

  getURL() {
    return this.url
  }

  getFrontCoverURL() {
    return this.frontCoverURL
  }

  getMetadata() {
    return this.songMetadata
  }

  getTotalDuration() {
    return this.totalDuration
  }

  setTotalDuration(totalDuration: number) {
    this.totalDuration = totalDuration
  }

  disposeBlobAndBuffer() {
    if (this.url) {
      URL.revokeObjectURL(this.url)
      this.url = undefined
    }

    if (this.blob) {
      this.blob = undefined
    }

    if (this.buffer) {
      this.buffer = undefined
    }
  }

  disposeAll() {
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
  }
}
