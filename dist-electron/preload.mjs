"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("App", {
  FileSystem: {
    selectSong: () => {
      console.trace("executing selectSong()");
      return electron.ipcRenderer.invoke("selectSong");
    }
  },
  MusicManager: {
    getSongBuffer: async (songPath) => {
      console.trace(`executing getSongBuffer(${songPath})`);
      return electron.ipcRenderer.invoke("getSongBuffer", songPath);
    },
    getSongMetadata: async (songPath) => {
      console.trace(`executing getSongMetadata(${songPath})`);
      return electron.ipcRenderer.invoke("getSongMetadata", songPath);
    }
  }
});
