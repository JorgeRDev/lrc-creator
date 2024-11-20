<script setup lang="ts">
import { inject } from "vue"
import { useRouter } from "vue-router"
import ActualSong from "../lib/actualSong"

const actualSong = inject<ActualSong>("actualSong", new ActualSong())

const selectSong = inject<() => Promise<void>>("selectSong", async () => {
  try {
    const songPath = await window.App.FileSystem.selectSong()

    if (songPath) {
      await actualSong.value.loadSong(songPath)
    }
  } catch (err) {
    console.error(err)
  }
})
const router = useRouter()

async function selectSongAndGoToEdit() {
  try {
    await selectSong()
    if (actualSong.value.songPath) {
      router.push("/edit")
    }
  } catch (err) {
    console.error(err)
  }
}
</script>

<template>
  <main
    class="flex flex:column gap:1rem place-content:center align-items:center"
  >
    <h1 class="f:36 f:bold">.lrc Creator</h1>
    <button
      @click="selectSongAndGoToEdit"
      class="bg:beryl-42 bg:beryl-50:hover p:0.5rem r:4px"
    >
      Select song
    </button>
  </main>
</template>
