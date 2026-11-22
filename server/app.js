import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getProduct, toProduct } from "./database.js";

const MAX_MOVEMENT_QUANTITY = 1_000_000;
const MAX_STOCK = 2_000_000_000;
const MAX_PRICE = 1_000_000_000;
const DIST_DIRECTORY = fileURLToPath(new URL("../dist/", import.meta.url));

function sendError(response, status, code, message, details) {
	const error = { code, message };
	if (details) error.details = details;
	return response.status(status).json({ error });
}

function validateProduct(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { error: "Request body must be a JSON object." };
	}

	const title = typeof body.title === "string" ? body.title.trim() : "";
	const sku = typeof body.sku === "string" ? body.sku.trim().toUpperCase() : "";
	const category = typeof body.category === "string" ? body.category.trim() : "";
	const price = body.price;
	const lowStockThreshold = body.lowStockThreshold === undefined ? 10 : body.lowStockThreshold;

	if (!title || title.length > 100) return { error: "Product name is required and must be 100 characters or fewer." };
	if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(sku)) {
		return { error: "SKU must be 1–32 characters using letters, numbers, dots, underscores or hyphens." };
	}
	if (!category || category.length > 50) return { error: "Category is required and must be 50 characters or fewer." };
	if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
		return { error: "Price must be a number from 0 to 1,000,000,000." };
	}
	if (!Number.isSafeInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > MAX_MOVEMENT_QUANTITY) {
		return { error: "Low-stock threshold must be a whole number from 0 to 1,000,000." };
	}

	return {
		value: { title, sku, category, price, lowStockThreshold }
	};
}

function validateMovement(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { error: "Request body must be a JSON object." };
	}
	if (body.type !== "receive" && body.type !== "remove") {
		return { error: "Movement type must be 'receive' or 'remove'." };
	}
	if (!Number.isSafeInteger(body.quantity) || body.quantity <= 0 || body.quantity > MAX_MOVEMENT_QUANTITY) {
		return { error: "Quantity must be a whole number from 1 to 1,000,000." };
	}
	if (body.note !== undefined && (typeof body.note !== "string" || body.note.trim().length > 500)) {
		return { error: "Note must be 500 characters or fewer." };
	}

	return {
		value: {
			type: body.type,
			quantity: body.quantity,
			note: body.note?.trim() ?? ""
		}
	};
}

function parseProductId(value) {
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getMovements(database, productId) {
	return database.prepare(`
		SELECT id, product_id, type, quantity, note, created_at
		FROM stock_movements
		WHERE product_id = ?
		ORDER BY id ASC
	`).all(productId).map((movement) => ({
		id: Number(movement.id),
		productId: Number(movement.product_id),
		type: movement.type,
		quantity: Number(movement.quantity),
		note: movement.note,
		createdAt: movement.created_at
	}));
}

function getAllMovements(database, type) {
	const filter = type ? "WHERE movement.type = ?" : "";
	const rows = database.prepare(`
		SELECT movement.id, movement.product_id, movement.type, movement.quantity,
			movement.note, movement.created_at, product.title, product.sku
		FROM stock_movements AS movement
		JOIN products AS product ON product.id = movement.product_id
		${filter}
		ORDER BY movement.id DESC
	`).all(...(type ? [type] : []));

	return rows.map((movement) => ({
		id: Number(movement.id),
		productId: Number(movement.product_id),
		type: movement.type,
		quantity: Number(movement.quantity),
		note: movement.note,
		createdAt: movement.created_at,
		title: movement.title,
		sku: movement.sku
	}));
}

function recordMovement(database, productId, movement, requestKey) {
	database.exec("BEGIN IMMEDIATE");
	try {
		const previous = requestKey
			? database.prepare("SELECT * FROM stock_movements WHERE request_key = ?").get(requestKey)
			: null;
		if (previous) {
			database.exec("ROLLBACK");
			if (Number(previous.product_id) !== productId
				|| previous.type !== movement.type
				|| Number(previous.quantity) !== movement.quantity
				|| previous.note !== movement.note) {
				return { error: "idempotency_key_reused" };
			}
			return {
				product: getProduct(database, productId),
				movement: {
					id: Number(previous.id),
					productId,
					type: previous.type,
					quantity: Number(previous.quantity),
					note: previous.note,
					createdAt: previous.created_at
				},
				replayed: true
			};
		}

		const current = database.prepare("SELECT stock FROM products WHERE id = ?").get(productId);
		if (!current) {
			database.exec("ROLLBACK");
			return { error: "not_found" };
		}

		const currentStock = Number(current.stock);
		if (movement.type === "remove" && movement.quantity > currentStock) {
			database.exec("ROLLBACK");
			return {
				error: "insufficient_stock",
				available: currentStock
			};
		}

		const nextStock = movement.type === "receive"
			? currentStock + movement.quantity
			: currentStock - movement.quantity;
		if (nextStock > MAX_STOCK) {
			database.exec("ROLLBACK");
			return { error: "stock_limit" };
		}

		const now = new Date().toISOString();
		database.prepare("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?").run(nextStock, now, productId);
		const inserted = database.prepare(`
			INSERT INTO stock_movements (product_id, type, quantity, note, created_at, request_key)
			VALUES (?, ?, ?, ?, ?, ?)
		`).run(productId, movement.type, movement.quantity, movement.note, now, requestKey);
		database.exec("COMMIT");

		return {
			product: getProduct(database, productId),
			movement: {
				id: Number(inserted.lastInsertRowid),
				productId,
				...movement,
				createdAt: now
			},
			replayed: false
		};
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

export function createApiApp(database) {
    const app = express();

    app.disable("x-powered-by");

    // Allow requests from the published Hostinger website.
    const allowedOrigin = process.env.FRONTEND_ORIGIN;

    if (allowedOrigin) {
        app.use("/api", cors({
            origin: allowedOrigin,
            methods: ["GET", "POST"],
            allowedHeaders: [
                "Content-Type",
                "Idempotency-Key"
            ]
        }));
    }

    app.use(express.json({ limit: "16kb" }));

	app.get("/api/health", (_request, response) => {
		return response.json({ status: "ok" });
	});

	app.get("/api/movements", (request, response) => {
		const type = request.query.type;

		if (
			type !== undefined &&
			type !== "receive" &&
			type !== "remove"
		) {
			return sendError(
				response,
				400,
				"INVALID_MOVEMENT_TYPE",
				"Movement type must be 'receive' or 'remove'."
			);
		}

		return response.json({
			movements: getAllMovements(database, type)
		});
	});

	app.get("/api/products", (_request, response) => {
		const products = database.prepare("SELECT * FROM products ORDER BY id ASC").all().map(toProduct);
		response.json({ products, total: products.length });
	});

	app.post("/api/products", (request, response) => {
		const validation = validateProduct(request.body);
		if (validation.error) return sendError(response, 400, "INVALID_PRODUCT", validation.error);

		const { title, sku, category, price, lowStockThreshold } = validation.value;
		const now = new Date().toISOString();
		const result = database.prepare(`
			INSERT INTO products (title, sku, category, price, low_stock_threshold, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(sku) DO NOTHING
		`).run(title, sku, category, price, lowStockThreshold, now, now);

		if (result.changes === 0) {
			return sendError(response, 409, "DUPLICATE_SKU", `A product with SKU ${sku} already exists.`);
		}

		return response.status(201).json({ product: getProduct(database, Number(result.lastInsertRowid)) });
	});

	app.get("/api/products/:id", (request, response) => {
		const id = parseProductId(request.params.id);
		if (!id) return sendError(response, 400, "INVALID_PRODUCT_ID", "Product ID must be a positive whole number.");

		const product = getProduct(database, id);
		if (!product) return sendError(response, 404, "PRODUCT_NOT_FOUND", `Product ${id} was not found.`);
		return response.json({ product });
	});

	app.get("/api/products/:id/movements", (request, response) => {
		const id = parseProductId(request.params.id);
		if (!id) return sendError(response, 400, "INVALID_PRODUCT_ID", "Product ID must be a positive whole number.");
		if (!getProduct(database, id)) {
			return sendError(response, 404, "PRODUCT_NOT_FOUND", `Product ${id} was not found.`);
		}
		return response.json({ movements: getMovements(database, id) });
	});

	app.post("/api/products/:id/movements", (request, response) => {
		const id = parseProductId(request.params.id);
		if (!id) return sendError(response, 400, "INVALID_PRODUCT_ID", "Product ID must be a positive whole number.");

		const validation = validateMovement(request.body);
		if (validation.error) return sendError(response, 400, "INVALID_MOVEMENT", validation.error);
		const requestKey = request.get("Idempotency-Key") || null;
		if (requestKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)) {
			return sendError(response, 400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–128 letters, numbers, dots, underscores, colons or hyphens.");
		}

		const result = recordMovement(database, id, validation.value, requestKey);
		if (result.error === "not_found") {
			return sendError(response, 404, "PRODUCT_NOT_FOUND", `Product ${id} was not found.`);
		}
		if (result.error === "insufficient_stock") {
			return sendError(response, 409, "INSUFFICIENT_STOCK", "Cannot remove more stock than is available.", {
				available: result.available
			});
		}
		if (result.error === "stock_limit") {
			return sendError(response, 409, "STOCK_LIMIT_EXCEEDED", `Stock cannot exceed ${MAX_STOCK} units.`);
		}
		if (result.error === "idempotency_key_reused") {
			return sendError(response, 409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request.");
		}

		return response.status(result.replayed ? 200 : 201).json(result);
	});

	app.use((req, res, next) => {
		res.setHeader(
			"Access-Control-Allow-Origin",
			"https://rural-yellowgreen-gnat-89.hostingersite.com"
		);

		res.setHeader(
			"Access-Control-Allow-Methods",
			"GET, POST, OPTIONS"
		);

		res.setHeader(
			"Access-Control-Allow-Headers",
			"Content-Type, Idempotency-Key"
		);

		if (req.method === "OPTIONS") {
			return res.sendStatus(204);
		}

		next();
	});

	app.use("/api", (_request, response) => sendError(response, 404, "API_ROUTE_NOT_FOUND", "API endpoint was not found."));

	if (existsSync(DIST_DIRECTORY)) {
		app.use(express.static(DIST_DIRECTORY));
		app.use((request, response, next) => {
			if (request.method !== "GET") return next();
			return response.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url)), (error) => {
				if (error) next(error);
			});
		});
	}

	app.use((error, _request, response, _next) => {
		if (response.headersSent) return;
		if (error.type === "entity.parse.failed") {
			return sendError(response, 400, "INVALID_JSON", "Request body must contain valid JSON.");
		}
		if (error.type === "entity.too.large") {
			return sendError(response, 413, "REQUEST_TOO_LARGE", "Request body must be 16 KB or smaller.");
		}

		console.error(error);
		return sendError(response, 500, "INTERNAL_SERVER_ERROR", "The server could not complete the request.");
	});

	return app;
}
