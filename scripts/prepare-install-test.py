"""Create isolated installation regression fixtures from a production XPI."""
import argparse
import copy
import json
from pathlib import Path
import shutil
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("xpi", type=Path)
args = parser.parse_args()
target = Path(__file__).resolve().parent.parent / ".scaffold" / "install-probe"
target.mkdir(parents=True, exist_ok=True)
shutil.copyfile(args.xpi, target / "release.xpi")
with zipfile.ZipFile(args.xpi) as src:
    manifest = json.loads(src.read("manifest.json"))
    update_url = manifest["applications"]["zotero"]["update_url"]
    assert update_url.startswith("https://raw.githubusercontent.com/wzq-come-on/")
    for name, include_update_url in [
        ("missing-update-url.xpi", False),
        ("restored-update-url.xpi", True),
    ]:
        with zipfile.ZipFile(target / name, "w", zipfile.ZIP_DEFLATED) as dst:
            for entry in src.infolist():
                contents = src.read(entry.filename)
                if entry.filename == "manifest.json":
                    fixture = json.loads(contents)
                    if not include_update_url:
                        del fixture["applications"]["zotero"]["update_url"]
                    contents = json.dumps(fixture, ensure_ascii=False).encode("utf-8")
                dst.writestr(copy.copy(entry), contents)
print("Prepared production XPI and required-field installation fixtures.")
