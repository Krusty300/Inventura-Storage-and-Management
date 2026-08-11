"""Shared pagination caps.

Kept in one place so the API contract and the frontend pickers that request
large pages stay in sync (frontend mirrors these in src/utils/constants.ts).
"""

# Standard paginated list endpoints.
MAX_PAGE_SIZE = 200

# Dropdown / lookup endpoints (locations, categories, customers) whose rows
# must be fetchable in one request to populate pickers.
MAX_PAGE_SIZE_LOOKUP = 5000

# LPN and supplier pickers, which send moderately large pages.
MAX_PAGE_SIZE_PICKER = 500

# Frontend product pickers request up to this many rows in one go.
MAX_PAGE_SIZE_PRODUCTS = 1000
