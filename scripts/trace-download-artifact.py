"""Download an exact public CI artifact for local scanning, without executing it."""
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import zipfile


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


artifact_id, expected = sys.argv[1:3]
request = urllib.request.Request(
    f"https://api.github.com/repos/bisrib613/flowpilot/actions/artifacts/{int(artifact_id)}/zip",
    headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json"},
)
try:
    response = urllib.request.build_opener(NoRedirect).open(request, timeout=30)
except urllib.error.HTTPError as error:
    if error.code not in (301, 302, 303, 307, 308):
        raise RuntimeError(f"Artifact API HTTP {error.code}") from None
    target = error.headers["Location"]
    if not target.startswith("https://"):
        raise RuntimeError("Non-HTTPS artifact redirect")
    # Never forward the GitHub token to the artifact storage host.
    response = urllib.request.urlopen(target, timeout=60)

root = Path("trace-artifact")
root.mkdir(exist_ok=True)
archive = root / "original.zip"
with response, archive.open("wb") as stream:
    total = 0
    while chunk := response.read(65536):
        total += len(chunk)
        if total > 30_000_000:
            raise RuntimeError("Artifact exceeds investigation size limit")
        stream.write(chunk)
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if actual != expected:
    raise RuntimeError("Original artifact hash does not match GitHub metadata")
files = [{"name": archive.name, "sha256": actual, "bytes": archive.stat().st_size}]
with zipfile.ZipFile(archive) as zipped:
    for info in zipped.infolist():
        if info.is_dir():
            continue
        path = Path(info.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in info.filename or info.file_size > 30_000_000:
            raise RuntimeError("Unexpected archive member")
        data = zipped.read(info)
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        files.append({"name": info.filename, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
Path("trace-files.json").write_text(json.dumps(files, indent=2))
print(json.dumps(files, indent=2))
