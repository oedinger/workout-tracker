#!/usr/bin/env python3
"""Build the deployable worker.js: worker_template.js + index.html embedded
as a JSON string (no escaping hazards). Same technique as homework-build."""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(BASE, "index.html"), encoding="utf-8").read()
tpl = open(os.path.join(BASE, "worker_template.js"), encoding="utf-8").read()
out = tpl.replace("__HTML_JSON__", json.dumps(html, ensure_ascii=False))
assert "__HTML_JSON__" not in out, "placeholder was not replaced"
open(os.path.join(BASE, "worker.js"), "w", encoding="utf-8").write(out)
print("worker.js bytes:", len(out))
