"""Minimal dotenv stand-in for offline tests."""


def load_dotenv(*args, **kwargs):
    return False
