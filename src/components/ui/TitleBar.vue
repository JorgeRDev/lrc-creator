<script setup lang="ts">
import IconVue from "../icons/IconVue.vue";
</script>

<template>
  <div
    class="title-bar-drag-region abs top:0 left:$(title-bar-left) w:$(title-bar-width) h:$(title-bar-height) max-h:$(title-bar-height) min-h:$(title-bar-height) bg:$(color-background)"
  >
    <div class="rel h:100% w:100%">
      <div class="abs top:0 left:0 w:100% h:100% @webkit-app-region-drag"></div>
      <div class="flex h:100% align-items:center">
        <p class="ml:1rem font-color:$(color-text) f:12 font-weight:medium">
          Media Player
        </p>
      </div>
    </div>
  </div>
</template>

<style>
/* .title-bar-drag-region {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  -webkit-app-region: drag;
}

.title-bar-content {
  display: flex;
  align-items: center;
} */
</style>
