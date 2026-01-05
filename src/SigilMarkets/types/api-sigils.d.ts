declare module "./api/sigils/seal.js" {
  const handler: (req: unknown, res: unknown) => Promise<void>;
  export default handler;
}

declare module "./api/sigils/[id].js" {
  const handler: (req: unknown, res: unknown) => Promise<void>;
  export default handler;
}