import { createApp } from "vue"
import App from "./App.vue"
import router from "./router"

import "@master/css"

import "./assets/styles/styles.css"

createApp(App).use(router).mount("#app")
