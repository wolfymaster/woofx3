import type { HttpDeps } from "../http";

/**
 * `GET /frames/{moduleId}/{manifestId}?theme=…&v=…` — a widget's frame
 * document (see `FrameAssembler.assembleDocument`). Public: it holds the
 * widget's own code and nothing about any scene or placement, which reach
 * the frame through the URL's fragment, never the server.
 */
export async function handleFrameDocumentRoute(
  req: Request,
  moduleId: string,
  manifestId: string,
  deps: HttpDeps
): Promise<Response> {
  const url = new URL(req.url);
  return deps.frameAssembler.assembleDocument(
    moduleId,
    manifestId,
    url.searchParams.get("theme"),
    url.searchParams.get("v")
  );
}
