<script setup lang="ts">
import PlayIcon from "../icons/PlayIcon.vue"
import { inject } from "vue"

const playPauseSong = inject("playPauseSong", () => {})
</script>

<template>
  <button
    class="rel aspect:1/1 h:4rem bg:$(color-ui-background) bg:$(color-ui-background-hover):hover cursor:pointer round"
    @click="playPauseSong"
  >
    <div class="abs top:51% left:53% transform:translate(-50%,-50%)">
      <div class="aspect:1/1 h:25px">
        <PlayIcon />
      </div>
    </div>
  </button>
</template>
