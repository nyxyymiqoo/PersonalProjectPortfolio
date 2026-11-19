# Stockroom inventory

Stockroom is a small inventory app for tracking product details and recording stock changes. It is a learning project: React handles the interface, while a local API validates changes and stores products and movement history in SQLite.

## Features

- View six starter products, search by name or SKU, and filter by category.
- Create products with a unique SKU. A new product always starts with zero stock.
- Record stock receipts and removals, with an optional note for each movement.
- See current stock, per-product low-stock alerts, and inventory summaries.
- Use Overview for low-stock alerts and recent activity.
- Record order fulfillment by removing stock, then review removals in Orders.
- Use Reports for category totals, movement totals, and the stock ledger.
- Export the product list or movement report to CSV.

## Screenshots

No screenshots are committed yet. Before publishing, capture the dashboard at desktop and narrow-screen widths and add them under `docs/screenshots/`.

## Stack

- React 19 and Vite
- Node.js HTTP server with Express 5
- SQLite through Node's built-in `node:sqlite` module
- Node's built-in test runner

Use Node.js 22.13 or newer. The API and UI run on the same origin in production; Vite proxies `/api` to the local API during development.

## Run locally

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The API starts on port 3001. Its SQLite file is created automatically at `data/inventory.sqlite`; the first run inserts six starter products and records their opening quantities as stock receipts.

To run the checks and build the production UI:

```sh
npm test
npm run build
npm start
```

`npm start` serves the built UI and API together. Set `PORT` to change the server port, `HOST` to change its bind address, or `DB_PATH` to choose another SQLite file. The database is intentionally ignored by Git; back it up separately if its contents matter.

## API

All errors use `{ "error": { "code": "...", "message": "...", "details": {} } }` (the `details` field is only included when useful).

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check that the server is running |
| `GET` | `/api/movements` | List the stock movement ledger (`?type=receive` or `?type=remove` filters it) |
| `GET` | `/api/products` | List products and current stock |
| `POST` | `/api/products` | Create a product at zero stock |
| `GET` | `/api/products/:id` | Read one product |
| `GET` | `/api/products/:id/movements` | Read its chronological stock history |
| `POST` | `/api/products/:id/movements` | Receive or remove stock |

Example product:

```json
{
  "title": "Desk lamp",
  "sku": "LMP-100",
  "category": "Home & Living",
  "price": 39.5,
  "lowStockThreshold": 5
}
```

Example movement:

```json
{
  "type": "receive",
  "quantity": 12,
  "note": "Supplier delivery"
}
```

Movement quantity must be a positive whole number. A removal larger than available stock returns `409 INSUFFICIENT_STOCK`; duplicate SKUs return `409 DUPLICATE_SKU`; invalid fields return `400`; unknown product IDs return `404`. The React app sends an `Idempotency-Key` for each movement so retrying the same request cannot apply it twice.

## Stock and persistence decisions

The server owns product validation and all stock rules. There is no endpoint for editing a product's quantity directly: only a valid receipt or removal can change it. Each movement, its note, and its timestamp are stored in `stock_movements`, linked to a product by a foreign key. The current quantity is updated in the same SQLite transaction as the movement record, so a failed removal changes neither.

The stored quantity is a convenient current-state value; the movement ledger also lets the app reconstruct how it got there. Sample products' opening quantities are recorded as initial receipts for the same reason. SQLite keeps this data after the server restarts, unlike an in-memory JavaScript array.

The browser shows loading and retry states for API failures, keeps form errors next to the action that failed, and updates the table only after the server confirms a change. A rejected stale removal refreshes the displayed stock from the server's available-quantity detail.

## Tests

Run `npm test`. The API tests cover product creation, missing fields, case-insensitive duplicate SKUs, receiving and removing stock, repeated idempotency keys, unknown products, invalid quantities, overselling, movement history, starter data, and persistence after reopening the database.

## Limitations and next steps

- This is a local, single-store demo with no authentication, roles, or hosted database.
- Product edits and deletion are not implemented. Deletion would need a policy for preserving movement history.
- Categories are free-form in the API, but the current form offers the categories already in the inventory.
- The database file is local to the server. Public deployment needs a persistent disk or managed database and a backup plan; deploying only the static React build will not provide the API.
- The current screenshot is not checked in. Capture desktop and mobile views before sharing the project publicly.
