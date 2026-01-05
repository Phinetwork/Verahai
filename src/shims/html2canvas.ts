// html2canvas.ts
type Html2CanvasOptions = Record<string, unknown>;
type Html2CanvasFn = (element: HTMLElement, options?: Html2CanvasOptions) => Promise<HTMLCanvasElement>;

let cached: Html2CanvasFn | null = null;
let loading: Promise<Html2CanvasFn> | null = null;

const loadHtml2Canvas = async (): Promise<Html2CanvasFn> => {
  if (cached) return cached;
  if (loading) return loading;

  loading = import("html2canvas").then((mod) => {
    const fn = (mod as unknown as { default?: Html2CanvasFn }).default ?? (mod as unknown as Html2CanvasFn);
    cached = fn;
    return fn;
  });

  return loading;
};

export default async function html2canvas(
  element: HTMLElement,
  options?: Html2CanvasOptions,
): Promise<HTMLCanvasElement> {
  const fn = await loadHtml2Canvas();
  return fn(element, options);
}
