import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "./PdfViewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

export function PdfViewer({ pdfPath }: { pdfPath: string }) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [pageInput, setPageInput] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const filename = pdfPath.split("/").pop() ?? pdfPath;

  // Load PDF bytes once
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // read_file_bytes returns Vec<u8> which Tauri serializes as a number array
        const nums = await invoke<number[]>("read_file_bytes", { path: pdfPath });
        if (cancelled) return;
        const bytes = new Uint8Array(nums);
        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pdfPath]);

  // Render page whenever doc / page / zoom changes
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    renderTaskRef.current?.cancel();
    let cancelled = false;

    async function render() {
      const page = await pdfDoc!.getPage(currentPage);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: zoom });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      const task = page.render({ canvasContext: ctx, viewport, canvas: canvasRef.current! });
      renderTaskRef.current = task;
      await task.promise;
    }

    render().catch((e) => {
      if (e?.name !== "RenderingCancelledException") console.error(e);
    });

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfDoc, currentPage, zoom]);

  const goToPage = useCallback(
    (n: number) => {
      const p = Math.max(1, Math.min(n, totalPages));
      setCurrentPage(p);
      setPageInput(String(p));
    },
    [totalPages]
  );

  const commitPageInput = useCallback(() => {
    goToPage(parseInt(pageInput, 10) || 1);
  }, [pageInput, goToPage]);

  const fitToWindow = useCallback(async () => {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(currentPage);
    const vp = page.getViewport({ scale: 1 });
    const padW = 40, padH = 80;
    const scaleW = (window.innerWidth - padW) / vp.width;
    const scaleH = (window.innerHeight - padH) / vp.height;
    setZoom(+(Math.min(scaleW, scaleH)).toFixed(2));
  }, [pdfDoc, currentPage]);

  const fitToWidth = useCallback(async () => {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(currentPage);
    const vp = page.getViewport({ scale: 1 });
    setZoom(+((window.innerWidth - 40) / vp.width).toFixed(2));
  }, [pdfDoc, currentPage]);

  return (
    <div className="pdf-root">
      <div className="pdf-toolbar">
        {/* Page navigation */}
        <button
          className="pdf-btn"
          onClick={() => goToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          title="Previous page"
        >
          ‹
        </button>
        <input
          className="pdf-page-input"
          type="number"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={commitPageInput}
          onKeyDown={(e) => e.key === "Enter" && commitPageInput()}
          title="Jump to page"
        />
        <span className="pdf-page-of">/ {totalPages}</span>
        <button
          className="pdf-btn"
          onClick={() => goToPage(currentPage + 1)}
          disabled={currentPage >= totalPages}
          title="Next page"
        >
          ›
        </button>

        <span className="pdf-toolbar-sep" />

        {/* Zoom controls */}
        <button
          className="pdf-btn"
          onClick={() => setZoom((z) => +(Math.max(ZOOM_MIN, z - ZOOM_STEP)).toFixed(2))}
          disabled={zoom <= ZOOM_MIN}
          title="Zoom out"
        >
          −
        </button>
        <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button
          className="pdf-btn"
          onClick={() => setZoom((z) => +(Math.min(ZOOM_MAX, z + ZOOM_STEP)).toFixed(2))}
          disabled={zoom >= ZOOM_MAX}
          title="Zoom in"
        >
          +
        </button>

        <span className="pdf-toolbar-sep" />

        <button className="pdf-btn" onClick={fitToWindow} title="Fit whole page">
          Fit Page
        </button>
        <button className="pdf-btn" onClick={fitToWidth} title="Fit page width">
          Fit Width
        </button>

        <span className="pdf-filename" title={pdfPath}>
          {filename}
        </span>
      </div>

      <div className="pdf-canvas-area">
        {error ? (
          <div className="pdf-error">Failed to load PDF: {error}</div>
        ) : !pdfDoc ? (
          <div className="pdf-loading">Loading…</div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
}
