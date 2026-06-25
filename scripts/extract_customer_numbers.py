#!/usr/bin/env python3
"""Extract unique South African +27 phone numbers from a PDF customer export."""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Iterable


PHONE_RE = re.compile(r"\+27\d{9}\b")


def read_pdf_text(pdf_path: Path) -> str:
    """Read text from a PDF page-by-page using pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: pypdf. Install it with `python -m pip install pypdf`."
        ) from exc

    reader = PdfReader(str(pdf_path))
    page_text: list[str] = []

    for page_number, page in enumerate(reader.pages, start=1):
        try:
            page_text.append(page.extract_text() or "")
        except Exception as exc:
            print(f"Warning: could not read page {page_number}: {exc}", file=sys.stderr)

    return "\n".join(page_text)


def extract_unique_numbers(text: str) -> list[str]:
    """Return de-duplicated +27 phone numbers, preserving first-seen order."""
    seen: set[str] = set()
    numbers: list[str] = []

    for line in text.splitlines():
        if "No name" in line:
            continue

        for match in PHONE_RE.finditer(line):
            phone = match.group(0)
            if phone in seen:
                continue

            seen.add(phone)
            numbers.append(phone)

    return numbers


def write_csv(numbers: Iterable[str], output_path: Path) -> None:
    """Write a single-column CSV ready for bulk SMS or WhatsApp validation."""
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["phone"])
        for number in numbers:
            writer.writerow([number])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract unique +27 phone numbers from a PDF customer export."
    )
    parser.add_argument(
        "pdf",
        nargs="?",
        default="amazol_customer_export_neat (1).pdf",
        help="Path to the PDF report.",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="extracted_numbers.csv",
        help="Output CSV path.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pdf_path = Path(args.pdf).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not pdf_path.is_file():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    text = read_pdf_text(pdf_path)
    numbers = extract_unique_numbers(text)
    write_csv(numbers, output_path)

    print(f"Extracted {len(numbers)} unique phone numbers to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
