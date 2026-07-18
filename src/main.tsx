import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import { useThemeStore } from "./store/themeStore";
import "./index.css";

// Apply the persisted theme to <html> before first paint (avoids a flash).
useThemeStore.getState().setTheme(useThemeStore.getState().theme);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
