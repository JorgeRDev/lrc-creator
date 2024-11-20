<script setup lang="ts">
import PlayerComponent from "./components/ui/PlayerComponent.vue"
import TitleBar from "./components/ui/TitleBar.vue"
import { selectSong, actualSong, playPauseSong } from "./lib/lrcCreator"
import { provide } from "vue"
import {
  slider,
  isDragging,
  tempSliderValue,
} from "./lib/playbackPositionSlider"

provide("slider", slider)
provide("isDragging", isDragging)
provide("tempSliderValue", tempSliderValue)
provide("actualSong", actualSong)
provide("playPauseSong", playPauseSong)
provide("selectSong", selectSong)
</script>

<template>
  <TitleBar />
  <RouterView />
</template>

<style>
main {
  padding-top: var(--title-bar-height);
  height: 100%;
}
</style>
