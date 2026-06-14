import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { GlowOverlay } from "./app/GlowOverlay";
import "./styles.css";

const surface = new URLSearchParams(window.location.search).get("surface");
const Root = surface === "glow" ? GlowOverlay : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
