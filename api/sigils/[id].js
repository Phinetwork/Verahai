import { sigilStore } from "./store.js";

export default async function handler(req, res) {
  const idRaw = req.query?.id;
  const id = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  if (!id) {
    res.statusCode = 400;
    res.end("missing id");
    return;
  }

  const svg = sigilStore.get(id);
  if (!svg) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.end(svg);
}

export const config = {
  runtime: "nodejs",
};
