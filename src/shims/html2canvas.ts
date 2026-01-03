type Html2CanvasOptions = Record<string, unknown>;

type Html2CanvasFn = (element: HTMLElement, options?: Html2CanvasOptions) => Promise<HTMLCanvasElement>;

let cached: Html2CanvasFn | null = null;
let loading: Promise<Html2CanvasFn> | null = null;

const getWindow = (): (Window & { html2canvas?: Html2CanvasFn }) | null => {
  if (typeof window === "undefined") return null;
  return window as Window & { html2canvas?: Html2CanvasFn };
};

const loadHtml2Canvas = async (): Promise<Html2CanvasFn> => {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const win = getWindow();
    if (win?.html2canvas) {
      cached = win.html2canvas;
      return win.html2canvas;
    }

    const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm");
    const fn = (mod as { default?: Html2CanvasFn }).default ?? (mod as Html2CanvasFn);

    if (win) win.html2canvas = fn;
    cached = fn;

    return fn;
  })();

  return loading;
};

const html2canvas = async (element: HTMLElement, options?: Html2CanvasOptions): Promise<HTMLCanvasElement> => {
  const fn = await loadHtml2Canvas();
  return fn(element, options);
};

export default html2canvas;
