"""Minimal fastapi.responses stand-ins for offline tests."""


class JSONResponse:
    def __init__(self, content=None, status_code=200, headers=None):
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}


class Response:
    def __init__(self, content=b"", media_type=None, headers=None):
        self.body = content.encode() if isinstance(content, str) else content
        self.media_type = media_type
        self.headers = headers or {}


class HTMLResponse(Response):
    def __init__(self, content="", status_code=200, headers=None):
        super().__init__(content, media_type="text/html", headers=headers)
        self.status_code = status_code
