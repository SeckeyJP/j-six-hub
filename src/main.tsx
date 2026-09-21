import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { processDef, program } from "./data";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root が無い");

createRoot(root).render(
  <StrictMode>
    <App data={program} process={processDef} />
  </StrictMode>,
);
