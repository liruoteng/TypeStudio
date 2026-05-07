import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { PdfViewer } from "./components/PdfViewer/PdfViewer";

const pdfPath = new URLSearchParams(window.location.search).get("pdfPath");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {pdfPath ? <PdfViewer pdfPath={pdfPath} /> : <App />}
  </React.StrictMode>
);
