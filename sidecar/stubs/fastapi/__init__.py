"""Minimal fastapi stand-ins for offline tests (no network, no server)."""
from .responses import HTMLResponse, JSONResponse, Response  # noqa: F401


class HTTPException(Exception):
    def __init__(self, status_code=500, detail=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class Request:
    pass


class APIRouter:
    def __init__(self, *args, **kwargs):
        self.routes = []

    def _dec(self, path, methods):
        def deco(fn):
            self.routes.append((methods, path, fn))
            return fn
        return deco

    def get(self, path, **kw):
        return self._dec(path, ["GET"])

    def post(self, path, **kw):
        return self._dec(path, ["POST"])

    def delete(self, path, **kw):
        return self._dec(path, ["DELETE"])

    def put(self, path, **kw):
        return self._dec(path, ["PUT"])
