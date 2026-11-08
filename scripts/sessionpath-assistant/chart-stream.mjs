export const CHART_HEARTBEAT_MS = 10_000;

// Transport only: the model still returns one bounded descriptive JSON result.
// Comments prevent idle intermediary timeouts without retrying the paid request.
export function chartEventResponse(run, {headers, boundedText, signal, heartbeatMs = CHART_HEARTBEAT_MS} = {}) {
  const encoder = new TextEncoder(), upstreamAbort = new AbortController();
  let closed = false, heartbeat, streamController;
  const cleanup = cancelled => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    signal?.removeEventListener('abort', abortClient);
    if (cancelled) upstreamAbort.abort();
  };
  const abortClient = () => {
    if (closed) return;
    cleanup(true);
    try {streamController?.error(new DOMException('The chart request was cancelled.', 'AbortError'));} catch {}
  };
  const stream = new ReadableStream({
    async start(controller) {
      streamController = controller;
      if (signal?.aborted) {abortClient(); return;}
      signal?.addEventListener('abort', abortClient, {once: true});
      controller.enqueue(encoder.encode(': connected\n\n'));
      heartbeat = setInterval(() => {
        if (closed) return;
        try {controller.enqueue(encoder.encode(': heartbeat\n\n'));}
        catch {cleanup(true);}
      }, heartbeatMs);
      let payload;
      try {
        const response = await run(upstreamAbort.signal);
        payload = JSON.parse(await boundedText(response.body, 65_536));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.ok !== 'boolean') throw new Error('Invalid chart result');
      } catch {
        payload = {ok: false, error: {code: 'CHART_STREAM_FAILED', message: 'The chart reader could not complete this request. No automatic retry was made.'}};
      }
      if (closed) return;
      try {controller.enqueue(encoder.encode('event: result\ndata: ' + JSON.stringify(payload) + '\n\n'));}
      catch {cleanup(true); return;}
      cleanup(false);
      controller.close();
    },
    cancel() {cleanup(true);},
  });
  return new Response(stream, {status: 200, headers: {...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'}});
}

export function wantsChartEvents(request) {
  return (request.headers.get('Accept') ?? '').split(',').some(part => part.split(';')[0].trim().toLowerCase() === 'text/event-stream' && !/;\s*q=0(?:\.0*)?(?:\s*;|\s*$)/i.test(part));
}
