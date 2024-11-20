import { ComputedRef, inject, ref, Ref, computed } from "vue"
import ActualSong from "../lib/actualSong"
import { API as SliderAPI } from "nouislider"

const slider: Ref<SliderAPI | undefined> = ref(undefined)

const isDragging: Ref<boolean> = ref(false)

const tempSliderValue: Ref<number> = ref(0)

export { slider, isDragging, tempSliderValue }
