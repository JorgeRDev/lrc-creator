<script setup lang="ts">
import {
  ComputedRef,
  computed,
  inject,
  Ref,
  ref,
  watchEffect,
  onMounted,
  watch,
  provide,
  onUnmounted,
  onActivated,
  onDeactivated,
} from "vue"
import ActualSong from "../../lib/actualSong"
import { create as createSlider, API as SliderAPI } from "nouislider"
import pino from "pino"
import { slider, isDragging } from "../../lib/playbackPositionSlider"

const logger = pino({
  level: "trace",
})

const isFullScreen: Ref<boolean> = inject("isFullScreen", ref(false))

const isFullScreenComputed = computed(() => isFullScreen.value)

watch(isFullScreenComputed, () => {
  const styles = document.styleSheets[3]

  logger.info(`document.styleSheets`)
  if (isFullScreenComputed.value === true) {
    if (styles != null) {
      console.log(`updating ${styles}`)

      Array.from(styles.cssRules).findIndex(
        (rule) => rule.selectorText === ".track-progress-connect"
      ) >= 0 &&
        styles.deleteRule(
          Array.from(styles.cssRules).findIndex(
            (rule) => rule.selectorText === ".track-progress-connect"
          )
        )
      styles.insertRule(
        `.track-progress-connect { background-color: white; opacity: 0.6; height: 3px; }`,
        styles.cssRules.length
      )
    }
  } else {
    if (styles != null) {
      console.log(`updating ${styles}`)
      Array.from(styles.cssRules).findIndex(
        (rule) => rule.selectorText === ".track-progress-connect"
      ) >= 0 &&
        styles.deleteRule(
          Array.from(styles.cssRules).findIndex(
            (rule) => rule.selectorText === ".track-progress-connect"
          )
        )
      Array.from(styles.cssRules).findIndex(
        (rule) => rule.selectorText === ".track-progress-handle"
      ) >= 0 &&
        styles.deleteRule(
          Array.from(styles.cssRules).findIndex(
            (rule) => rule.selectorText === ".track-progress-handle"
          )
        )

      styles.insertRule(
        `.track-progress-connect { background-color: var(--color-text); opacity: 0.6; height: 3px; }`,
        styles.cssRules.length
      )
      styles.insertRule(
        `.track-progress-handle { display: block; }`,
        styles.cssRules.length
      )
    }
  }
})

const actualSong: Ref<ActualSong | undefined> = inject(
  "actualSong",
  ref(undefined)
)

const tempSliderValue: Ref<number> = inject("tempSliderValue", ref(0))

const totalDuration: ComputedRef<number | undefined> = computed(
  () => actualSong.value?.totalDuration
)

const actualSongMetadata: ComputedRef<SongMetadata | undefined> = computed(
  () => actualSong.value?.songMetadata
)

const sliderHTMLElement: Ref<HTMLElement | null> = ref(null)

const actualDuration: ComputedRef<number> = inject(
  "actualDuration",
  computed(() => actualSong.value?.getActualDuration() ?? 0)
)

watchEffect(() => {
  if (!isDragging.value) {
    tempSliderValue.value = actualDuration.value
  }
})

onMounted(() => {
  logger.trace("Activating ProgressBar")

  logger.trace("Initializing slider")

  logger.trace(
    `Trying to create slider HTMLElement within ${sliderHTMLElement.value}`
  )

  slider.value = createSlider(sliderHTMLElement.value!, {
    range: {
      min: 0,
      max: 100,
    },
    start: [0],
    cssPrefix: "track-progress-",
  })

  slider.value.disable()

  if (totalDuration.value != undefined) {
    if (!isFullScreenComputed.value) {
      slider.value?.enable()
    }

    slider.value?.updateOptions(
      {
        animate: false,
        range: {
          min: 0,
          max: totalDuration.value ?? 0,
        },
        connect: "lower",
        start: [0],
      },
      false
    )
  }

  watch(totalDuration, () => {
    if (!isFullScreenComputed.value) {
      slider.value?.enable()
    }

    slider.value?.updateOptions(
      {
        animate: false,
        range: {
          min: 0,
          max: totalDuration.value ?? 0,
        },
        connect: "lower",
        start: [0],
      },
      false
    )
    logger.info("enabling slider")
    logger.info("updating slider options")
  })

  slider.value?.set(actualDuration.value)

  slider.value?.on("start", () => {
    logger.info(`The user has started dragging the slider`)
    isDragging.value = true
  })

  slider.value?.on("end", () => {
    logger.info(`The user has stopped dragging the slider`)
    isDragging.value = false
  })

  slider.value?.on("slide", (value) => {
    tempSliderValue.value = value[0]
  })

  slider.value?.on("change", (value) => {
    logger.info(`The slider has changed to ${value}`)
    actualSong.value?.setActualDuration(value[0])
  })

  watch(actualDuration, () => {
    if (!isDragging.value) {
      slider.value?.set(actualDuration.value)
    }
  })
})

onUnmounted(() => {
  logger.trace("Deactivating ProgressBar")
  logger.info("destroyed slider: ", slider.value)
})
</script>

<template>
  <div class="w:100% h:100%">
    <div ref="sliderHTMLElement" />
  </div>
</template>

<style>
[disabled] .track-progress-handle {
  display: none;
}

[disabled].track-progress-target {
  cursor: default;
}
[disabled] .track-progress-base::before {
  background-color: gray;
  opacity: 0.3;
}

[disabled] .track-progress-connect {
  background-color: white;
  opacity: 0.6;
}

.track-progress-horizontal {
  height: 12px;
  border-radius: 0;
}

.track-progress-horizontal .track-progress-handle {
  width: 10px;
  height: 10px;
  right: -6px;
  top: 1.45px;
}

.track-progress-handle {
  border-radius: 2rem;
  border: none;
  background-color: var(--color-playback-control-slider-background);
  box-shadow: none;
  cursor: pointer;
  scale: 0.5;
}

.track-progress-handle::before,
.track-progress-handle::after {
  display: none;
}

.track-progress-connect {
  background-color: var(--color-playback-control-slider-background);
  opacity: 0.6;
  height: 3px;
}

.track-progress-target {
  border: none;
  box-shadow: none;
  background-color: transparent;
}

.track-progress-touch-area {
  height: 150%;
  width: 150%;
  transform: translate(-11%, -20%);
}

.track-progress-base {
  height: 12px;
  padding: 5px 0 4px 0;
  background-color: transparent;
}

.track-progress-base::before {
  content: "";
  position: absolute;
  top: 50;
  left: 0;
  width: 100%;
  height: 3px;
  background-color: rgba(184, 184, 184, 0.5);
}
</style>
