/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  App: {
    FileSystem: {
      selectSong: () => Promise<SongPath | null>
    }
    MusicManager: {
      getSongBuffer: (songPath: SongPath) => Promise<Buffer | null>
      getSongMetadata: (songPath: SongPath) => Promise<SongInfo | null>
    }
  }
}
