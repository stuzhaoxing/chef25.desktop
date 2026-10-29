import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MessageViewport from "./MessageViewport";
import App from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <MessageViewport />
  </StrictMode>,
);
