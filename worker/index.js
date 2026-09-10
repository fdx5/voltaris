// Sites / Cloudflare Workers-compatible static frontend entrypoint.
export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== 'GET' || new URL(request.url).pathname.includes('.')) return response;
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  },
};
