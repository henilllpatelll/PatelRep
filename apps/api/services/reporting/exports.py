"""CSV / PDF renderers for a ``ReportDocument`` (plain dict, see ``documents.py``).

Both renderers only format data the caller already authorised; they never query.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import Any
from xml.sax.saxutils import escape

MAX_TABLE_ROWS = 500  # bounded output; truncation is stated in the file
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: Any) -> Any:
    """Neutralise spreadsheet-formula injection for string cells (numbers pass through)."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def safe_filename(*parts: str) -> str:
    joined = "-".join(p for p in parts if p)
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", joined).strip("-.")
    return (cleaned or "report")[:120]


def _display(value: Any) -> str:
    return "" if value is None else str(value)


# ── CSV ──────────────────────────────────────────────────────────────────────


def render_csv(doc: dict) -> bytes:
    """UTF-8 (with BOM for Excel) CSV: metadata block, KPI table, then one block per table."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    period = doc.get("period") or {}
    comparison = doc.get("comparison")

    writer.writerow(["Report", csv_safe(doc.get("title", ""))])
    writer.writerow(["Property", csv_safe(doc.get("hotel_name", ""))])
    writer.writerow(["Period start", period.get("start", "")])
    writer.writerow(["Period end", period.get("end", "")])
    writer.writerow(["Timezone", period.get("timezone", "")])
    if comparison:
        writer.writerow(["Comparison start", comparison.get("start", "")])
        writer.writerow(["Comparison end", comparison.get("end", "")])
    if doc.get("department"):
        writer.writerow(["Department", csv_safe(doc["department"])])
    writer.writerow(["Generated at", doc.get("generated_at", "")])

    kpis = doc.get("kpis") or []
    if kpis:
        writer.writerow([])
        writer.writerow(["Key metrics"])
        writer.writerow(["metric", "value", "unit", "previous", "change", "change_type", "eligible_records", "availability", "note"])
        for k in kpis:
            writer.writerow([
                csv_safe(k.get("label", "")), csv_safe(_display(k.get("value"))), k.get("unit", ""),
                csv_safe(_display(k.get("previous"))), csv_safe(_display(k.get("change"))), k.get("change_kind", "") or "",
                _display(k.get("eligible")), k.get("availability", ""), csv_safe(k.get("note", "") or ""),
            ])

    for table in doc.get("tables") or []:
        writer.writerow([])
        writer.writerow([csv_safe(table.get("title", ""))])
        columns = table.get("columns") or []
        writer.writerow([csv_safe(c["label"]) for c in columns])
        rows = table.get("rows") or []
        for row in rows[:MAX_TABLE_ROWS]:
            writer.writerow([csv_safe(_display(row.get(c["key"]))) for c in columns])
        if len(rows) > MAX_TABLE_ROWS or table.get("truncated"):
            writer.writerow([f"Truncated: showing first {MAX_TABLE_ROWS} rows"])

    if doc.get("definitions"):
        writer.writerow([])
        writer.writerow(["Metric definitions"])
        writer.writerow(["metric", "definition", "numerator", "denominator", "cohort", "exclusions", "source"])
        for d in doc["definitions"]:
            writer.writerow([csv_safe(d.get(k, "")) for k in ("label", "definition", "numerator", "denominator", "cohort", "exclusions", "source")])

    for note in doc.get("notes") or []:
        writer.writerow([])
        writer.writerow(["Note", csv_safe(note)])
    return ("﻿" + out.getvalue()).encode("utf-8")


# ── PDF ──────────────────────────────────────────────────────────────────────

_INK = "#1f2937"
_MUTED = "#6b7280"
_LINE = "#e5e7eb"
_ACCENT = "#b45309"


def _kpi_value(k: dict) -> str:
    value = k.get("value")
    if value is None:
        return {
            "not_applicable": "Not applicable",
            "not_configured": "Not configured",
            "not_enough_data": "Not enough data",
            "unavailable": "Unavailable",
        }.get(k.get("availability"), "Unavailable")
    unit = k.get("unit") or ""
    suffix = {"percent": "%", "minutes": " min", "hours": " h"}.get(unit, "")
    prefix = "$" if unit == "currency" else ""
    return f"{prefix}{value}{suffix}"


def render_pdf(doc: dict) -> bytes:
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        KeepTogether,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buffer = io.BytesIO()
    period = doc.get("period") or {}
    comparison = doc.get("comparison")
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, textColor=colors.HexColor(_INK), alignment=0, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, textColor=colors.HexColor(_INK), spaceBefore=14, spaceAfter=6)
    body = ParagraphStyle("body", parent=styles["BodyText"], fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor(_INK))
    muted = ParagraphStyle("muted", parent=body, textColor=colors.HexColor(_MUTED), fontSize=8)
    cell = ParagraphStyle("cell", parent=body, fontSize=8, leading=10)

    def para(text: Any, style=body) -> Paragraph:
        return Paragraph(escape(_display(text)), style)

    def footer(canvas, document):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor(_MUTED))
        canvas.drawString(document.leftMargin, 0.45 * inch, f"PatelRep · {doc.get('hotel_name', '')} · {doc.get('title', '')}")
        canvas.drawRightString(letter[0] - document.rightMargin, 0.45 * inch, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()

    template = SimpleDocTemplate(
        buffer, pagesize=letter, leftMargin=0.7 * inch, rightMargin=0.7 * inch,
        topMargin=0.7 * inch, bottomMargin=0.8 * inch,
        title=str(doc.get("title", "Report")), author="PatelRep",
    )
    width = letter[0] - 1.4 * inch
    story: list = []

    story.append(Paragraph("PatelRep", ParagraphStyle("brand", parent=muted, textColor=colors.HexColor(_ACCENT), fontName="Helvetica-Bold", fontSize=9)))
    story.append(para(doc.get("title", "Report"), h1))
    story.append(para(doc.get("hotel_name", ""), body))
    period_line = f"Period: {period.get('start', '')} to {period.get('end', '')} ({period.get('timezone', '')})"
    if comparison:
        period_line += f" · Compared with {comparison.get('start', '')} to {comparison.get('end', '')}"
    story.append(para(period_line, muted))
    if doc.get("department"):
        story.append(para(f"Department: {doc['department']}", muted))
    story.append(para(f"Generated {doc.get('generated_at', '')}", muted))
    story.append(Spacer(1, 6))

    kpis = doc.get("kpis") or []
    if kpis:
        story.append(para("Key metrics", h2))
        data = [[para(k.get("label", ""), cell), para(_kpi_value(k), ParagraphStyle("kv", parent=cell, fontName="Helvetica-Bold", fontSize=10)),
                 para(_compare_text(k), cell)] for k in kpis]
        t = Table(data, colWidths=[width * 0.42, width * 0.2, width * 0.38])
        t.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor(_LINE)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)

    for chart in doc.get("charts") or []:
        values = [p.get("value") for p in chart.get("points", [])]
        labels = [str(p.get("label", ""))[-5:] for p in chart.get("points", [])]
        if not any(v is not None for v in values):
            continue
        drawing = Drawing(width, 140)
        bar = VerticalBarChart()
        bar.x, bar.y, bar.width, bar.height = 30, 25, width - 50, 95
        bar.data = [[v if v is not None else 0 for v in values]]
        bar.categoryAxis.categoryNames = labels
        bar.categoryAxis.labels.fontSize = 6
        bar.categoryAxis.labels.angle = 45 if len(labels) > 12 else 0
        bar.valueAxis.labels.fontSize = 7
        bar.bars[0].fillColor = colors.HexColor(_ACCENT)
        drawing.add(bar)
        story.append(KeepTogether([para(chart.get("title", ""), h2), drawing,
                                   para("Missing buckets are plotted as empty; they are not zero values.", muted)]))

    for exc in doc.get("exceptions") or []:
        if exc is (doc.get("exceptions") or [None])[0]:
            story.append(para("Needs attention", h2))
        story.append(para(f"[{exc.get('severity', '')}] {exc.get('title', '')} — {exc.get('detail', '')}", body))

    for table in doc.get("tables") or []:
        columns = table.get("columns") or []
        if not columns:
            continue
        rows = (table.get("rows") or [])[:MAX_TABLE_ROWS]
        story.append(para(table.get("title", ""), h2))
        if not rows:
            story.append(para("No records for this selection.", muted))
            continue
        header = [para(c["label"], ParagraphStyle("th", parent=cell, fontName="Helvetica-Bold")) for c in columns]
        data = [header] + [[para(r.get(c["key"]), cell) for c in columns] for r in rows]
        t = Table(data, colWidths=[width / len(columns)] * len(columns), repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
            ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor(_LINE)),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(t)
        if len(table.get("rows") or []) > MAX_TABLE_ROWS or table.get("truncated"):
            story.append(para(f"Showing the first {MAX_TABLE_ROWS} rows.", muted))

    if doc.get("definitions"):
        story.append(para("Metric definitions", h2))
        for d in doc["definitions"]:
            story.append(para(f"{d.get('label', '')}: {d.get('definition', '')}", body))
            story.append(para(f"Numerator: {d.get('numerator', '')} · Denominator: {d.get('denominator', '')} · Cohort: {d.get('cohort', '')} · Exclusions: {d.get('exclusions', '')}", muted))
            story.append(Spacer(1, 3))

    for note in doc.get("notes") or []:
        story.append(Spacer(1, 4))
        story.append(para(note, muted))

    template.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def _compare_text(k: dict) -> str:
    if k.get("change") is None:
        return k.get("note") or ""
    kind = "pp" if k.get("change_kind") == "percentage_points" else "%"
    sign = "+" if k["change"] > 0 else ""
    return f"{sign}{k['change']}{kind} vs {k.get('previous')} ({k.get('direction', '')})"


def render_generated_at(now: datetime) -> str:
    return now.strftime("%Y-%m-%d %H:%M UTC")
