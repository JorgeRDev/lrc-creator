import { Ref, ref, inject } from "vue"
import ActualSong from "./actualSong"
import pino, { Logger } from "pino"
import { useRouter } from "vue-router"

const logger: Logger<never, boolean> = pino({ level: "trace" })

const actualSong: Ref<ActualSong> = ref(new ActualSong())
async function selectSong(): Promise<void> {
  try {
    const songPath = await window.App.FileSystem.selectSong()

    if (songPath) {
      await actualSong.value.loadSong(songPath)
    }
  } catch (err) {
    console.error(err)
  }
}

async function playPauseSong() {
  logger.info(`executing playPauseSong()`)
  if (actualSong.value.song === undefined) {
    throw new Error("Song is undefined. Try calling loadAndPlaySong() first")
  }

  const isPlaying = await actualSong.value.isPlaying()

  if (isPlaying) {
    await actualSong.value.pause()
  } else {
    await actualSong.value.play()
  }
}

export { selectSong, actualSong, playPauseSong }
