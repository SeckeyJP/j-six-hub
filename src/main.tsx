import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { events, processDef } from "./data";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が無い");

createRoot(root).render(
  <StrictMode>
    <App events={events} process={processDef} />
  </StrictMode>,
);
