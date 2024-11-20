import { dialog, ipcMain } from "electron"
import { readFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { parseWebStream } from "music-metadata"
import { basename, extname } from "node:path"
import { uint8ArrayToBase64 } from "uint8array-extras"
import { inspect } from "node:util"
import SongMetadata from "../lib/songMetadata"

import pino, { Logger } from "pino"

const logger: Logger<never, boolean> = pino({ level: "silent" })

ipcMain.handle("selectSong", async (): Promise<SongPath | null> => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "Select song",
      filters: [{ name: "Audio files", extensions: ["mp3", "flac"] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  } catch (err) {
    console.error("Error selecting files: ", err)
    throw err
  }
})

ipcMain.handle(
  "getSongBuffer",
  async (event, songPath: string): Promise<Buffer | undefined> => {
    logger.info(`executing getSong(${songPath}) handler`)

    logger.trace(`reading file ${songPath}`)
    const song = await readFile(songPath)

    if (song) {
      logger.info(`getSong(${songPath}) has returned the song successfully`)
      return song
    } else {
      logger.info(`getSong(${songPath}) has failed`)
      return undefined
    }
  }
)

ipcMain.handle(
  "getSongMetadata",
  async (event, songPath: SongPath): Promise<SongMetadata | null> => {
    logger.info(`executing getSongMetadata(${songPath})`)

    let nodeStream
    let songStream

    nodeStream = createReadStream(songPath)

    nodeStream.on("open", async (fd) => {
      try {
      } catch (err) {}
    })

    nodeStream.on("error", (error) => {})

    // 3. Verificar si está leyendo datos
    nodeStream.on("data", (chunk) => {})

    // 4. Saber cuando termina
    nodeStream.on("end", () => {})

    songStream = new ReadableStream({
      type: "bytes",
      start(controller) {
        nodeStream.on("data", (chunk) => {
          controller.enqueue(chunk)
        })
        nodeStream.on("end", () => controller.close())
        nodeStream.on("error", (error) => controller.error(error))
      },
      cancel() {
        nodeStream.destroy()
      },
    })
    const songMetadata = await parseWebStream(
      songStream,
      {
        mimeType: "audio",
      },
      {
        observer: (update) => {
          if (
            update.metadata.common.title &&
            update.metadata.common.album &&
            update.metadata.common.picture &&
            update.metadata.common.year &&
            update.metadata.common.artist &&
            update.metadata.common.albumartist &&
            update.metadata.common.genre &&
            update.metadata.format.duration &&
            update.metadata.format.container
          ) {
            songStream.cancel()
          }
        },
      }
    )

    if (songMetadata != undefined) {
      const _songMetadata: SongMetadata = new SongMetadata()
      if (songMetadata.common.title != undefined) {
        _songMetadata.title = songMetadata.common.title
      } else {
        _songMetadata.title = basename(songPath, extname(songPath))
      }
      _songMetadata.album = songMetadata.common.album
      if (songMetadata.common.picture != undefined) {
        _songMetadata.frontCover = uint8ArrayToBase64(
          songMetadata.common.picture[0].data
        )
      }
      _songMetadata.year = songMetadata.common.year
      _songMetadata.artist = songMetadata.common.artist
      _songMetadata.albumArtist = songMetadata.common.albumartist
      _songMetadata.genre = songMetadata.common.genre
      _songMetadata.duration = songMetadata.format.duration
      _songMetadata.itemType = songMetadata.format.container
      _songMetadata.format = songMetadata.format.container

      logger.info(
        `getSongMetadata(${songPath}) returned ${inspect(_songMetadata, {
          breakLength: Infinity,
          maxArrayLength: 2,
          maxStringLength: 50,
        })}`
      )
      return _songMetadata
    }
    return null
  }
)
