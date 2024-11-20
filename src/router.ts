import { createRouter, createWebHashHistory } from "vue-router"

import HomeView from "./views/HomeView.vue"
import EditView from "./views/EditView.vue"

const routes = [
  { path: "/", component: HomeView },
  { path: "/edit", component: EditView },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
