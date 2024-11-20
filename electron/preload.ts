import { contextBridge, ipcRenderer } from "electron"
import { SongInfo } from "../src/lib/songInfo"

contextBridge.exposeInMainWorld("App", {
  FileSystem: {
    selectSong: (): Promise<SongPath | null> => {
      console.trace("executing selectSong()")
      return ipcRenderer.invoke("selectSong")
    },
  },
  MusicManager: {
    getSongBuffer: async (songPath: SongPath): Promise<Buffer | null> => {
      console.trace(`executing getSongBuffer(${songPath})`)
      return ipcRenderer.invoke("getSongBuffer", songPath)
    },
    getSongMetadata: async (songPath: SongPath): Promise<SongInfo | null> => {
      console.trace(`executing getSongMetadata(${songPath})`)
      return ipcRenderer.invoke("getSongMetadata", songPath)
    },
  },
})
