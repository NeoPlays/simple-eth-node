import { createRouter, createWebHashHistory } from "vue-router";

//Views
import LoginView from "@views/LoginView.vue";
import NodeManagerView from "@views/NodeManagerView.vue";

const routes = [
  {
    path: "/login",
    name: "Login",
    component: LoginView
  },
  {
    path: "/",
    name: "NodeManager",
    component: NodeManagerView
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
