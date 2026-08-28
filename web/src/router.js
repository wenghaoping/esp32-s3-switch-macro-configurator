import { createRouter, createWebHashHistory } from "vue-router";
import HomePage from "./pages/HomePage.vue";
import ControlPage from "./pages/ControlPage.vue";
import ScriptsPage from "./pages/ScriptsPage.vue";
import ScriptEditorPage from "./pages/ScriptEditorPage.vue";
import RecorderPage from "./pages/RecorderPage.vue";
import DevicePage from "./pages/DevicePage.vue";

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: HomePage },
    { path: "/control", component: ControlPage },
    { path: "/scripts", component: ScriptsPage },
    { path: "/scripts/:slot/edit", component: ScriptEditorPage },
    { path: "/recorder", component: RecorderPage },
    { path: "/device", component: DevicePage },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
