"""Offline test runner: pytest is not installed here, so this supplies the
two fixtures the test files use (monkeypatch, tmp_path) and runs every
test_* function, reporting pass/fail like pytest -q would.
"""
import importlib.util
import inspect
import sys
import tempfile
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "stubs"))
sys.path.insert(0, str(HERE))  # so `app` resolves to ./app


class MiniMonkeypatch:
    def __init__(self):
        self._undo = []

    def setattr(self, target, name=None, value=None, raising=True):
        if name is None:
            # dotted-path form: monkeypatch.setattr("a.b.c", value)
            dotted, value = target, name
            parts = dotted.split(".")
            target = sys.modules[parts[0]]
            for p in parts[1:-1]:
                target = getattr(target, p)
            name = parts[-1]
        if raising and not hasattr(target, name):
            raise AttributeError(name)
        had = hasattr(target, name)
        old = getattr(target, name, None)
        setattr(target, name, value)
        self._undo.append((target, name, had, old))

    def setenv(self, key, value):
        import os
        self.setitem(os.environ, key, value)

    def setitem(self, mapping, key, value):
        had = key in mapping
        old = mapping.get(key)
        mapping[key] = value
        self._undo.append(("item", mapping, key, had, old))

    def undo(self):
        for entry in reversed(self._undo):
            if entry[0] == "item":
                _, mapping, key, had, old = entry
                if had:
                    mapping[key] = old
                else:
                    del mapping[key]
            else:
                target, name, had, old = entry
                if had:
                    setattr(target, name, old)
                else:
                    delattr(target, name)
        self._undo = []


def run_module(path: Path):
    spec = importlib.util.spec_from_file_location("t_" + path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    passed, failed = 0, []
    fns = [(n, f) for n, f in sorted(vars(mod).items())
           if n.startswith("test_") and callable(f)]
    for name, fn in fns:
        params = inspect.signature(fn).parameters
        kwargs = {}
        mp = MiniMonkeypatch()
        tmpdir = None
        try:
            if "monkeypatch" in params:
                kwargs["monkeypatch"] = mp
            if "tmp_path" in params:
                tmpdir = tempfile.TemporaryDirectory()
                kwargs["tmp_path"] = Path(tmpdir.name)
            fn(**kwargs)
            passed += 1
        except Exception:
            failed.append((name, traceback.format_exc()))
        finally:
            mp.undo()
            if tmpdir:
                tmpdir.cleanup()
    return passed, failed


def main():
    total_ok, total_fail = 0, []
    for path in sorted((HERE / "tests").glob("test_*.py")):
        ok, bad = run_module(path)
        total_ok += ok
        print(f"{path.name}: {ok} passed, {len(bad)} failed")
        for name, tb in bad:
            total_fail.append((path.name, name, tb))
    print(f"\n{total_ok} passed, {len(total_fail)} failed total")
    for fname, name, tb in total_fail:
        print(f"\n=== FAIL {fname}::{name} ===\n{tb}")
    sys.exit(1 if total_fail else 0)


if __name__ == "__main__":
    main()
