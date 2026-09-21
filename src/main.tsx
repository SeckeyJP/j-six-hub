import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root が無い");

createRoot(root).render(
  <StrictMode>
    <p>リプレイ（実際の AI は動作していません）— 準備中</p>
  </StrictMode>,
);
