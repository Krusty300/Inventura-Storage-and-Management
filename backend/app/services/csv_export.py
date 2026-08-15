import csv
from io import StringIO

from fastapi.responses import Response, StreamingResponse


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


def csv_stream_response(filename: str, headers: list[str], rows) -> StreamingResponse:
    """Stream a CSV from a lazy row iterable without buffering the whole body.

    ``rows`` is any iterable of lists (e.g. a query iterated with ``yield_per``),
    consumed one batch at a time as the response streams.
    """
    def generate():
        buf = StringIO()
        writer = csv.writer(buf)
        writer.writerow(headers)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for row in rows:
            writer.writerow(row)
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
    )
