"""Minimal httpx stand-in: importable, but any real call fails loudly."""


class _Resp:
    def __init__(self):
        self.status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        raise RuntimeError("no network in offline tests")


class Client:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, *args, **kwargs):
        raise RuntimeError("no network in offline tests")

    def post(self, *args, **kwargs):
        raise RuntimeError("no network in offline tests")
