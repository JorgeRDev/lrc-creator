import { Ref, ref } from "vue"
const isDragging: Ref<boolean> = ref(false)
const tempSliderValue: Ref<number> = ref(0)

export { isDragging, tempSliderValue }
