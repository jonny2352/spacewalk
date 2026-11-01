"""Guards for the localhost-only backend.

Binding to 127.0.0.1 keeps other machines out, but a web page open in your own browser can still reach it:
cross-site requests (they carry a foreign Origin) and DNS rebinding (they carry a foreign Host). Both are
rejected here, for HTTP and WebSocket alike. Clients that send no Origin (the Stream Deck plugin, curl) are fine.
"""
from urllib.parse import urlsplit

LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}


def _hostname(host_header: str) -> str:
    return urlsplit("//" + host_header).hostname or ""


def host_ok(host_header: str | None) -> bool:
    return _hostname(host_header or "") in LOCAL_HOSTS or (host_header or "").lower() in LOCAL_HOSTS


def origin_ok(origin: str | None) -> bool:
    if origin is None:
        return True
    parts = urlsplit(origin)
    return parts.scheme in ("http", "https") and (parts.hostname or "") in LOCAL_HOSTS


class LocalOnly:
    """ASGI middleware: 403 for HTTP and a closed handshake for WebSocket when Host or Origin is not local."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
            if not (host_ok(headers.get("host")) and origin_ok(headers.get("origin"))):
                if scope["type"] == "websocket":
                    await receive()  # the connect message
                    await send({"type": "websocket.close", "code": 1008})
                else:
                    body = b"forbidden: local access only"
                    await send({"type": "http.response.start", "status": 403,
                                "headers": [(b"content-type", b"text/plain"), (b"content-length", str(len(body)).encode())]})
                    await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
