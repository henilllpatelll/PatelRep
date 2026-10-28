"""Hotel timezone resolution that tolerates a malformed stored name.

`tenants.timezone` is saved from a free-text request field. python-dateutil 3
raises `DeprecatedTzKeyWarning` (a warning promoted to an error) from `gettz`
for a path-like key such as "../x", where 2.9 returned None. Callers already
fall back to America/Chicago on None, so map that failure to None as well.
"""
from datetime import tzinfo
from typing import Optional

from dateutil import tz


def safe_gettz(name: str) -> Optional[tzinfo]:
    try:
        return tz.gettz(name)
    except Exception:
        return None
