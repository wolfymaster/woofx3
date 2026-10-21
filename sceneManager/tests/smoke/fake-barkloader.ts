// Barkloader's widget frame endpoint, on a real port: every widget's frame is
// a small document that marks itself, so a test can tell which one it got.

export interface FakeBarkloader {
  url: string;
  /** The frame requests it answered, as `{moduleKey}/{manifestId}`. */
  frames: string[];
  stop(): void;
}

export function startFakeBarkloader(): FakeBarkloader {
  const frames: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const match = new URL(req.url).pathname.match(/^\/widgets\/([^/]+)\/([^/]+)\/frame$/);
      if (match === null) {
        return new Response("not found", { status: 404 });
      }
      const [, moduleKey, manifestId] = match;
      frames.push(`${moduleKey}/${manifestId}`);
      return Response.json({
        entryHtml: `<!doctype html><html><head></head><body data-widget="${manifestId}">${manifestId}</body></html>`,
        resourceBaseUrl: `http://127.0.0.1/assets/modules/${moduleKey}/v1/widgets/${manifestId}/`,
        theme: null,
        fontSettings: [],
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, frames, stop: () => server.stop(true) };
}
