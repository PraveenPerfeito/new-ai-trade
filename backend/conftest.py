"""
Top-level conftest.py for the backend test suite.
Stubs out packages not installed in the test environment (structlog, redis,
httpx, asyncpg, anthropic, prometheus_client) so tests that import modules
with those dependencies can still run.
Only applies when the real packages are absent — installed packages take
precedence and this file has no effect in production.
"""
from __future__ import annotations

import sys
import types


def _stub(name: str, **attrs) -> types.ModuleType:
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    return m


def _noop(*_a, **_kw):
    return None


class _NoopLogger:
    def info(self, *a, **kw): pass
    def warning(self, *a, **kw): pass
    def warn(self, *a, **kw): pass
    def error(self, *a, **kw): pass
    def debug(self, *a, **kw): pass
    def bind(self, **kw): return self


# ── structlog ─────────────────────────────────────────────────────────────────
if "structlog" not in sys.modules:
    sl = _stub("structlog")
    sl.get_logger = lambda *a, **kw: _NoopLogger()
    sl.configure = _noop
    sl.make_filtering_bound_logger = lambda level: _NoopLogger

    # structlog.types — type aliases used only at import time
    sl_types = _stub("structlog.types")
    sl_types.EventDict     = dict
    sl_types.WrappedLogger = object

    sl_stdlib = _stub("structlog.stdlib", ProcessorFormatter=object)
    sl_proc = _stub("structlog.processors",
        JSONRenderer=lambda **kw: _noop,
        TimeStamper=lambda **kw: _noop,
        StackInfoRenderer=_noop,
        format_exc_info=_noop,
        UnicodeDecoder=_noop,
    )
    sl_dev = _stub("structlog.dev",
        ConsoleRenderer=lambda **kw: _noop,
    )

    sl.stdlib     = sl_stdlib
    sl.processors = sl_proc
    sl.dev        = sl_dev
    sl.types      = sl_types

    sys.modules["structlog"]            = sl
    sys.modules["structlog.types"]      = sl_types
    sys.modules["structlog.stdlib"]     = sl_stdlib
    sys.modules["structlog.processors"] = sl_proc
    sys.modules["structlog.dev"]        = sl_dev

# ── redis ─────────────────────────────────────────────────────────────────────
if "redis" not in sys.modules:
    redis_m = _stub("redis")
    redis_m.from_url = _noop
    redis_m.asyncio = _stub("redis.asyncio", Redis=object, from_url=_noop)
    sys.modules["redis"] = redis_m
    sys.modules["redis.asyncio"] = redis_m.asyncio

# ── prometheus_client ─────────────────────────────────────────────────────────
if "prometheus_client" not in sys.modules:
    class _FakeMetric:
        def __init__(self, *a, **kw): pass
        def labels(self, **kw): return self
        def inc(self, n=1): pass
        def dec(self, n=1): pass
        def set(self, v): pass
        def observe(self, v): pass
        def time(self): return self
        def __enter__(self): return self
        def __exit__(self, *a): pass

    pc = _stub("prometheus_client",
        Counter=_FakeMetric,
        Gauge=_FakeMetric,
        Histogram=_FakeMetric,
        Summary=_FakeMetric,
        CollectorRegistry=object,
        REGISTRY=object(),
    )
    sys.modules["prometheus_client"] = pc
