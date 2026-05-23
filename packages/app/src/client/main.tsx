import { render } from "solid-js/web";
import { App } from "./App";
import { registerServiceWorker } from "./register-sw";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
render(() => <App />, root);
registerServiceWorker();
