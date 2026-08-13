import csv
from io import StringIO

from fastapi.responses import Response


def csv_response(filename: str, headers: list[str], rows: list[list]) -> Response:
    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
    )
