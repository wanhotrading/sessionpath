"""Create one WebP comparison preview per public trading date at publish time."""

import argparse
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath

from PIL import Image


MARKETS = {"CL": ("", "data"), "NQ": ("", "data/nq"), "ES": ("es", "es/data/es"), "GC": ("gc", "gc/data/gc")}
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
PATH_PART = re.compile(r"[a-zA-Z0-9._-]+")
PREVIEW_ROOT = PurePosixPath("charts/previews/v1")


def read_json(path, default):
    if not path.is_file():
        return default
    with path.open(encoding="utf-8-sig") as stream:
        return json.load(stream)


def image_path(docs, workspace, src):
    if not isinstance(src, str):
        return None
    parts = src.split("/")
    if (len(parts) < 2 or parts[0] != "charts" or
            any(part in {".", ".."} or not PATH_PART.fullmatch(part) for part in parts) or
            PurePosixPath(src).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}):
        return None
    path = PurePosixPath(workspace, *parts)
    resolved = docs.joinpath(*path.parts).resolve()
    if resolved.is_relative_to(docs) and resolved.is_file():
        return path
    return None


def candidates(docs, market, workspace, data_folder):
    selected = {}

    def add(date, contract, src, view, native):
        if not isinstance(date, str) or not DATE.fullmatch(date):
            return
        path = image_path(docs, workspace, src)
        if path is None:
            return
        priority = (view == "overview", native)
        if date not in selected or priority > selected[date][0]:
            selected[date] = (priority, (date, str(contract or "")[:20], path))

    index = read_json(docs / data_folder / "gallery-index.json", {})
    for day in read_json(docs / data_folder / "days.json", []):
        asset = index.get(str(day.get("index")))
        if isinstance(asset, dict):
            add(day.get("date"), day.get("contract"), asset.get("src"), asset.get("view") or "overview", False)

    manifest = read_json(docs / workspace / "data/public-screenshots.json", {})
    if manifest.get("version") == 1:
        for item in manifest.get(market, []):
            if item.get("instrument") == market and item.get("view") in {"overview", "detail"}:
                add(item.get("date"), item.get("contract"), item.get("src"), item.get("view"), True)

    return [record for _, record in selected.values()]


def build_preview(docs, folder, candidate):
    date, contract, original = candidate
    latest = {"date": date, "contract": contract, "src": original.as_posix()}
    source = docs.joinpath(*original.parts)
    original_bytes = source.stat().st_size
    with source.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()[:12]
    filename = f"{date}-{digest}.webp"
    target = folder / filename
    try:
        if not target.is_file():
            with Image.open(source) as image:
                image.thumbnail((800, 560), Image.Resampling.LANCZOS)
                image.convert("RGB").save(target, "WEBP", quality=81, method=3)
        preview_bytes = target.stat().st_size
    except OSError as error:
        print(f"Skipping preview for {original}: {error}")
        return latest, original_bytes, original_bytes
    if preview_bytes >= original_bytes:
        target.unlink()
        return latest, original_bytes, original_bytes
    latest["preview"] = filename
    return latest, original_bytes, preview_bytes


def main(docs):
    docs = docs.resolve()
    with ThreadPoolExecutor(max_workers=4) as executor:
        for market, (workspace, data_folder) in MARKETS.items():
            folder = docs.joinpath(*PREVIEW_ROOT.parts, market)
            folder.mkdir(parents=True, exist_ok=True)
            records = candidates(docs, market, workspace, data_folder)
            results = list(executor.map(lambda row: build_preview(docs, folder, row), records))
            images = sorted((record for record, _, _ in results), key=lambda record: record["date"])
            catalog = {"version": 1, "market": market, "images": images}
            (folder / "index.json").write_text(json.dumps(catalog, separators=(",", ":")) + "\n", encoding="utf-8")
            original = sum(before for _, before, _ in results)
            previews = sum(after for _, _, after in results)
            print(f"{market}: {len(images)} charts, {original:,} original bytes -> {previews:,} grid bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("docs", type=Path)
    main(parser.parse_args().docs)
