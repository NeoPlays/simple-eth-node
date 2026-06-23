import { createRouter, createWebHashHistory } from "vue-router";

//Views
import LoginView from "@views/LoginView.vue";
import NodeManagerView from "@views/NodeManagerView.vue";
import NodeView from "@views/NodeView.vue";
import UpdatesView from "@views/UpdatesView.vue";
import ServiceConfigView from "@views/ServiceConfigView.vue";
import ServiceLogsView from "@views/ServiceLogsView.vue";

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
    path: "/node/:id/updates",
    name: "Updates",
    component: UpdatesView
  },
  {
    path: "/node/:id/service/:serviceId",
    name: "ServiceConfig",
    component: ServiceConfigView
  },
  {
    path: "/node/:id/service/:serviceId/logs",
    name: "ServiceLogs",
    component: ServiceLogsView
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
