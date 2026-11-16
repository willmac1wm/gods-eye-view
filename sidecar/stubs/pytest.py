"""Minimal pytest stand-in: only what the offline tests use."""
import contextlib


@contextlib.contextmanager
def raises(exc):
    class _Info:
        value = None
    info = _Info()
    try:
        yield info
    except exc as e:
        info.value = e
        return
    raise AssertionError("did not raise %r" % (exc,))
