import { createRouter, createWebHashHistory } from "vue-router";

//Views
import LoginView from "@views/LoginView.vue";
import NodeManagerView from "@views/NodeManagerView.vue";
import NodeView from "@views/NodeView.vue";
import ServiceConfigView from "@views/ServiceConfigView.vue";

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
  },
  {
    path: "/node/:id",
    name: "Node",
    component: NodeView
  },
  {
    path: "/node/:id/service/:serviceId",
    name: "ServiceConfig",
    component: ServiceConfigView
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
