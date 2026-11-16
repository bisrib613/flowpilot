"""Local std-only Rust checks using the actual cache definitions/functions.

This does not compile Tauri/COM or simulate Windows native failure delivery.
No generated test or compiler is included in the packaged application or CI.
"""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
source = (root / "src-tauri/src/webview_manager.rs").read_text()


def function(name):
    start = source.index("fn " + name + "(")
    brace = source.index("{", start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


definitions = source[source.index("struct CachedView {"):source.index("fn service_url")]
helpers = source[source.index("fn touch_account("):source.index("#[cfg(windows)]\nfn attach_view_health")]
lease = source[source.index("pub struct BackgroundView {"):source.index("fn finish_background_view")]
tests = ["cache_promotion_preserves_controller_failure_state",
         "replacing_a_failed_cache_entry_isolated_from_old_native_callbacks",
         "background_cleanup_lease_survives_only_until_the_view_is_reused"]
body = "\n".join("#[test]\n" + function(name) for name in tests)
code = ('#![allow(dead_code)]\nuse std::{collections::HashMap, sync::{Arc, Mutex}};\n'
        '#[path = "' + str(root / "src-tauri/src/webview_health.rs") + '"]\nmod webview_health;\n'
        'use webview_health::ViewHealth;\n' + definitions + helpers + lease
        + '\n#[cfg(test)] mod tests { use super::*;\n' + body + '\n}\n')
with tempfile.TemporaryDirectory(prefix="flowpilot-health-") as directory:
    path = Path(directory)
    harness = path / "cache_health.rs"
    harness.write_text(code)
    binary = path / ("cache_health.exe" if os.name == "nt" else "cache_health")
    subprocess.run([os.environ.get("FLOWPILOT_RUSTC", "rustc"), "--edition=2021",
                    "--test", str(harness), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
