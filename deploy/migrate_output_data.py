"""Copy legacy output/data JSON files into the configured output directory.

The script is intended for deployments migrating from the in-repo `output/`
folder to an external persistent volume referenced by `SPAWNER_DATA_DIR`.
"""
from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = BASE_DIR / "output" / "data"
DEFAULT_DEST = Path(os.getenv("SPAWNER_DATA_DIR", str(BASE_DIR / "output"))).expanduser()


def copy_json_files(source: Path, destination_output_dir: Path, *, overwrite: bool = False) -> int:
    source = source.resolve()
    destination_output_dir = destination_output_dir.expanduser().resolve()
    destination = destination_output_dir / "data"

    if source == destination:
        print("Source and destination point to the same directory; nothing to migrate.")
        return 0

    if not source.exists():
        print(f"Source directory not found: {source}")
        return 0

    destination.mkdir(parents=True, exist_ok=True)

    migrated = 0
    for json_file in sorted(source.glob("*.json")):
        target = destination / json_file.name
        if target.exists() and not overwrite:
            print(f"Skipping {json_file.name}: already exists in destination.")
            continue

        shutil.copy2(json_file, target)
        migrated += 1
        print(f"Copied {json_file} -> {target}")

    if migrated == 0:
        print("No files copied.")
    return migrated


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Copy JSON data files from the legacy ./output/data directory to "
            "the output directory configured via SPAWNER_DATA_DIR."
        )
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Path to the old output/data directory (default: ./output/data).",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=DEFAULT_DEST,
        help=(
            "Target output directory (data will be placed into <dest>/data). "
            "Defaults to SPAWNER_DATA_DIR or ./output."
        ),
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite files that already exist in the destination.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    copied = copy_json_files(args.source, args.dest, overwrite=args.overwrite)
    print(f"Migration complete. Files copied: {copied}")
