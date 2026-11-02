// www.roundertools.com → https://roundertools.com, keeping the path and query (a permanent move, so links consolidate)
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = 'https:';
    url.hostname = 'roundertools.com';
    return Response.redirect(url.toString(), 301);
  },
};
