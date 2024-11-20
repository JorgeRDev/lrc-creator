<script setup lang="ts">
import { inject, Ref, ref } from "vue"
import { onBeforeRouteLeave } from "vue-router"
import PlayerComponent from "../components/ui/PlayerComponent.vue"
import ActualSong from "../lib/actualSong"

const actualSong: Ref<ActualSong> = inject("actualSong", ref(new ActualSong()))

onBeforeRouteLeave((to, from, next) => {
  console.log(`to: ${to.name}, from: ${String(from.name)}`)

  if (to.path === "/") {
    window.confirm("Are you sure you want to leave this page?")
    actualSong.value.disposeAll()
    next()
  }
})
</script>

<template>
  <main>
    <h2>Edit</h2>
    <div
      class="flex place-content:center align-items:center w:100% h:3rem bg:gray-20"
    >
      <button class="bg:red">+</button>
    </div>
  </main>
  <div class="abs bottom:0 left:0 right:0 h:$(player-height)">
    <PlayerComponent />
  </div>
</template>
