import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const sampleProducts = [
	{ title: "Everyday Ceramic Mug", sku: "MUG-001", category: "Kitchen", price: 18, stock: 42 },
	{ title: "Forma Table Lamp", sku: "LMP-014", category: "Home & Living", price: 89, stock: 8 },
	{ title: "Canvas Tote Bag", sku: "BAG-006", category: "Accessories", price: 26, stock: 0 },
	{ title: "Oak Lounge Chair", sku: "CHR-021", category: "Home & Living", price: 349, stock: 12 },
	{ title: "Glass Water Bottle", sku: "BOT-009", category: "Accessories", price: 32, stock: 5 },
	{ title: "Terra Serving Tray", sku: "TRY-003", category: "Kitchen", price: 44, stock: 27 }
];

export function createDatabase(databasePath, { seed = true } = {}) {
	if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

	const database = new DatabaseSync(databasePath);
	database.exec("PRAGMA foreign_keys = ON");
	database.exec("PRAGMA busy_timeout = 5000");
	database.exec(`
		CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY,
			title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 100),
			sku TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(sku)) BETWEEN 1 AND 32),
			category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 50),
			price REAL NOT NULL CHECK(price >= 0),
			stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0 AND stock <= 2000000000),
			low_stock_threshold INTEGER NOT NULL DEFAULT 10 CHECK(low_stock_threshold >= 0),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS stock_movements (
			id INTEGER PRIMARY KEY,
			product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
			type TEXT NOT NULL CHECK(type IN ('receive', 'remove')),
			quantity INTEGER NOT NULL CHECK(quantity > 0),
			note TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			request_key TEXT UNIQUE
		);
		CREATE INDEX IF NOT EXISTS stock_movements_product_id_id
			ON stock_movements(product_id, id);
	`);

	if (seed) seedSampleProducts(database);
	return database;
}

function seedSampleProducts(database) {
	const count = database.prepare("SELECT COUNT(*) AS count FROM products").get().count;
	if (count > 0) return;

	const now = new Date().toISOString();
	const addProduct = database.prepare(`
		INSERT INTO products (title, sku, category, price, stock, created_at, updated_at)
		VALUES (?, ?, ?, ?, 0, ?, ?)
	`);
	const addMovement = database.prepare(`
		INSERT INTO stock_movements (product_id, type, quantity, note, created_at)
		VALUES (?, 'receive', ?, 'Initial sample stock', ?)
	`);
	const setStock = database.prepare("UPDATE products SET stock = ? WHERE id = ?");

	database.exec("BEGIN IMMEDIATE");
	try {
		for (const product of sampleProducts) {
			const result = addProduct.run(product.title, product.sku, product.category, product.price, now, now);
			const productId = Number(result.lastInsertRowid);
			if (product.stock > 0) {
				addMovement.run(productId, product.stock, now);
				setStock.run(product.stock, productId);
			}
		}
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

export function toProduct(row) {
	return {
		id: Number(row.id),
		title: row.title,
		sku: row.sku,
		category: row.category,
		price: Number(row.price),
		stock: Number(row.stock),
		lowStockThreshold: Number(row.low_stock_threshold),
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export function getProduct(database, id) {
	const row = database.prepare("SELECT * FROM products WHERE id = ?").get(id);
	return row ? toProduct(row) : null;
}
