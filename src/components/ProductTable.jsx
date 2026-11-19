import React from "react";

function getStatus(stock, threshold) {
	if (stock === 0) return { label: "Out of stock", className: "out-of-stock" };
	if (stock <= threshold) return { label: "Low stock", className: "low-stock" };
	return { label: "In stock", className: "in-stock" };
}

function formatCategory(category) {
	return category
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export default function ProductTable({ products, loading, onManageStock }) {
	if (loading) {
		return <div className="table-message" role="status">Loading sample products…</div>;
	}

	if (products.length === 0) {
		return <div className="table-message">No products match your search.</div>;
	}

	return (
		<div className="table-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Product</th>
						<th scope="col">Category</th>
						<th scope="col">Price</th>
						<th scope="col">In stock</th>
						<th scope="col">Status</th>
						<th scope="col"><span className="visually-hidden">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{products.map((product) => {
						const status = getStatus(product.stock, product.lowStockThreshold);
						const fillClass = product.stock === 0 ? "out" : product.stock <= product.lowStockThreshold ? "low" : "";
						const fillWidth = Math.min((product.stock / 50) * 100, 100);

						return (
							<tr key={product.id}>
								<td>
									<div className="product-cell">
										<div className="product-thumb">
											{product.thumbnail
												? <img src={product.thumbnail} alt="" loading="lazy" />
												: <span aria-hidden="true">{product.title.charAt(0).toUpperCase()}</span>}
										</div>
										<div>
											<div className="product-name">{product.title}</div>
											<div className="product-sku">{product.sku}</div>
										</div>
									</div>
								</td>
								<td className="category">{formatCategory(product.category)}</td>
								<td>{product.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
								<td className="stock-cell">
									<span className="stock-number">{product.stock}</span>
									<div className="stock-track" aria-hidden="true">
										<div className={`stock-fill ${fillClass}`} style={{ width: `${fillWidth}%` }} />
									</div>
								</td>
								<td><span className={`status ${status.className}`}>{status.label}</span></td>
								<td>
									<button className="table-action" type="button" onClick={() => onManageStock(product)}>
										Manage stock
									</button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
