import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "../../stores/editorStore";
import "./PDFViewerPanel.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

interface ScholarResult {
  title: string;
  authors?: { name: string }[];
  year?: number;
  abstract?: string;
  url?: string;
}

interface PopupState {
  x: number;
  y: number;
  key: string;
  refText: string | null;
  result: ScholarResult | null;
  loading: boolean;
}

async function extractReferences(pdf: pdfjsLib.PDFDocumentProxy): Promise<Map<string, string>> {
  const refs = new Map<string, string>();
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((item) => (item as { str: string }).str).join(" ");
    pageTexts.push(text);
  }

  const fullText = pageTexts.join("\n");
  const refMatch = fullText.match(
    /(?:^|\n)\s*(?:References|Bibliography|REFERENCES|BIBLIOGRAPHY)\s*\n([\s\S]+?)(?:\n\s*(?:Appendix|Acknowledgment|About the|Index)\b|$)/i
  );
  if (!refMatch) return refs;

  const refSection = refMatch[1];

  const bracketPattern = /\[(\d+)\]\s+([\s\S]+?)(?=\[\d+\]|$)/g;
  let match;
  while ((match = bracketPattern.exec(refSection)) !== null) {
    refs.set(match[1], match[2].trim().replace(/\s+/g, " "));
  }

  if (refs.size === 0) {
    const numberedPattern = /^\s*(\d+)\.\s+([\s\S]+?)(?=^\s*\d+\.|$)/gm;
    while ((match = numberedPattern.exec(refSection)) !== null) {
      refs.set(match[1], match[2].trim().replace(/\s+/g, " "));
    }
  }

  return refs;
}

async function searchScholar(query: string): Promise<ScholarResult | null> {
  try {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query.slice(0, 200))}&fields=title,authors,year,abstract,url&limit=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data?.[0] as ScholarResult) ?? null;
  } catch {
    return null;
  }
}

export function PDFViewerPanel() {
  const activePdfPath = useEditorStore((s) => s.activePdfPath);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [refMap, setRefMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!activePdfPath) return;
    let active = true;
    setPdfDoc(null);
    setRefMap(new Map());
    setCurrentPage(1);
    setPageInput("1");

    (async () => {
      try {
        const data = await invoke<number[]>("read_file_bytes", { path: activePdfPath });
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
        if (!active) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        extractReferences(doc).then((refs) => {
          if (active) setRefMap(refs);
        });
      } catch (e) {
        console.error("Failed to load PDF:", e);
      }
    })();

    return () => {
      active = false;
    };
  }, [activePdfPath]);

  // Track which page is most visible as the user scrolls
  useEffect(() => {
    const container = containerRef.current;
    if (!container || numPages === 0 || !pdfDoc) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) {
          const n = parseInt((best.target as HTMLElement).dataset.page ?? "1", 10);
          setCurrentPage(n);
          setPageInput(String(n));
        }
      },
      { root: container, threshold: 0.3 }
    );

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [numPages, pdfDoc]);

  useEffect(() => {
    const dismiss = () => setPopup(null);
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, []);

  const scrollToPage = useCallback(
    (n: number) => {
      const page = Math.max(1, Math.min(n, numPages));
      const el = pageRefs.current.get(page);
      if (el && containerRef.current) {
        containerRef.current.scrollTo({ top: el.offsetTop - 16, behavior: "smooth" });
      }
      setCurrentPage(page);
      setPageInput(String(page));
    },
    [numPages]
  );

  const handleCitationClick = useCallback(
    async (x: number, y: number, citeText: string) => {
      const keyMatch = citeText.match(/\d+/);
      if (!keyMatch) return;
      const key = keyMatch[0];
      const refText = refMap.get(key) ?? null;
      const clampedX = Math.min(x, window.innerWidth - 336);

      setPopup({ x: clampedX, y, key, refText, result: null, loading: !!refText });

      if (refText) {
        const result = await searchScholar(refText);
        setPopup((prev) => (prev ? { ...prev, result, loading: false } : null));
      }
    },
    [refMap]
  );

  if (!activePdfPath) {
    return <div className="pdf-viewer-empty">No PDF selected</div>;
  }

  const filename = activePdfPath.split("/").pop() ?? activePdfPath;

  return (
    <div className="pdf-viewer-root">
      <div className="pdf-toolbar">
        <button
          className="pdf-btn"
          onClick={() => scrollToPage(currentPage - 1)}
          disabled={currentPage <= 1}
          title="Previous page"
        >
          ‹
        </button>
        <input
          className="pdf-page-input"
          type="number"
          min={1}
          max={numPages || 1}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={() => scrollToPage(parseInt(pageInput, 10) || 1)}
          onKeyDown={(e) => e.key === "Enter" && scrollToPage(parseInt(pageInput, 10) || 1)}
          title="Jump to page"
        />
        <span className="pdf-page-of">/ {numPages}</span>
        <button
          className="pdf-btn"
          onClick={() => scrollToPage(currentPage + 1)}
          disabled={currentPage >= numPages}
          title="Next page"
        >
          ›
        </button>

        <span className="pdf-toolbar-sep" />

        <button
          className="pdf-btn"
          onClick={() => setScale((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
          disabled={scale <= ZOOM_MIN}
          title="Zoom out"
        >
          −
        </button>
        <span className="pdf-zoom-label">{Math.round(scale * 100)}%</span>
        <button
          className="pdf-btn"
          onClick={() => setScale((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
          disabled={scale >= ZOOM_MAX}
          title="Zoom in"
        >
          +
        </button>

        <span className="pdf-filename" title={activePdfPath}>
          {filename}
        </span>
      </div>

      <div className="pdf-viewer-container" ref={containerRef}>
        {pdfDoc &&
          Array.from({ length: numPages }, (_, i) => (
            <PDFPage
              key={i + 1}
              pdf={pdfDoc}
              pageNumber={i + 1}
              scale={scale}
              onCitationClick={handleCitationClick}
              pageRef={(el) => {
                if (el) pageRefs.current.set(i + 1, el);
                else pageRefs.current.delete(i + 1);
              }}
            />
          ))}
      </div>

      {popup && (
        <div
          className="pdf-citation-popup"
          style={{ top: popup.y, left: popup.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pdf-citation-header">
            <span>Citation [{popup.key}]</span>
            <button className="pdf-popup-close" onClick={() => setPopup(null)}>
              ×
            </button>
          </div>
          {popup.refText ? (
            <div className="pdf-citation-body">
              <div className="pdf-ref-text">{popup.refText}</div>
              {popup.loading && (
                <div className="pdf-scholar-status">Searching Semantic Scholar…</div>
              )}
              {!popup.loading && popup.result && (
                <div className="pdf-scholar-result">
                  <div className="pdf-scholar-title">
                    {popup.result.url ? (
                      <a href={popup.result.url} target="_blank" rel="noreferrer">
                        {popup.result.title}
                      </a>
                    ) : (
                      popup.result.title
                    )}
                  </div>
                  <div className="pdf-scholar-meta">
                    {popup.result.authors?.slice(0, 3).map((a) => a.name).join(", ")}
                    {popup.result.year ? ` · ${popup.result.year}` : ""}
                  </div>
                  {popup.result.abstract && (
                    <div className="pdf-scholar-abstract">
                      {popup.result.abstract.slice(0, 220)}…
                    </div>
                  )}
                </div>
              )}
              {!popup.loading && !popup.result && (
                <div className="pdf-scholar-status">Not found on Semantic Scholar</div>
              )}
            </div>
          ) : (
            <div className="pdf-citation-body pdf-no-ref">
              Reference text not extracted from PDF.
              {refMap.size === 0 && " (References section not detected)"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PDFPageProps {
  pdf: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  onCitationClick: (x: number, y: number, text: string) => void;
  pageRef: (el: HTMLDivElement | null) => void;
}

function PDFPage({ pdf, pageNumber, scale, onCitationClick, pageRef }: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<pdfjsLib.PDFPageProxy | null>(null);

  useEffect(() => {
    let active = true;
    pdf.getPage(pageNumber).then((p) => {
      if (active) setPage(p);
    });
    return () => {
      active = false;
    };
  }, [pdf, pageNumber]);

  useEffect(() => {
    if (!page || !canvasRef.current || !textLayerRef.current) return;
    let active = true;
    let textLayer: pdfjsLib.TextLayer | null = null;

    const render = async () => {
      const dpr = window.devicePixelRatio || 1;
      // Build viewport at physical resolution; CSS size is 1/dpr of that.
      // pdf.js ignores canvasContext when canvas is non-null, so the viewport
      // must encode the full dpr scale directly.
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current!;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

      await page.render({ canvas, viewport }).promise;
      if (!active) return;

      const textLayerDiv = textLayerRef.current!;
      textLayerDiv.innerHTML = "";

      // Text layer must use CSS-pixel viewport (not the dpr-scaled one)
      const cssViewport = page.getViewport({ scale });
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent(),
        container: textLayerDiv,
        viewport: cssViewport,
      });

      await textLayer.render();
      if (!active) return;

      // Highlight citation patterns like [1], [2-4], [1, 2]
      textLayerDiv.querySelectorAll("span").forEach((span) => {
        const text = span.innerText;
        const replaced = text.replace(
          /(\[[\d\s,-]+\])/g,
          (m) => `<span class="pdf-citation-highlight">${m}</span>`
        );
        if (replaced !== text) {
          span.innerHTML = replaced;
          span.querySelectorAll<HTMLElement>(".pdf-citation-highlight").forEach((h) => {
            h.addEventListener("click", (e) => {
              e.stopPropagation();
              const rect = (e.target as Element).getBoundingClientRect();
              onCitationClick(rect.left, rect.bottom + 8, h.textContent ?? "");
            });
          });
        }
      });
    };

    render().catch((e) => {
      if (e?.name !== "RenderingCancelledException") console.error(e);
    });

    return () => {
      active = false;
      textLayer?.cancel();
    };
  }, [page, scale, onCitationClick]);

  return (
    <div className="pdf-page-wrapper" data-page={pageNumber} ref={pageRef}>
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer pdf-text-layer" />
    </div>
  );
}
