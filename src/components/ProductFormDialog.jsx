import React, { useEffect, useRef } from "react";

export default function ProductFormDialog({ open, categories, saving, error, onClose, onSubmit }) {
	const dialogRef = useRef(null);
	const formRef = useRef(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (open && !dialog.open) {
			formRef.current?.reset();
			dialog.showModal();
		}
		if (!open && dialog.open) dialog.close();
	}, [open]);

	function handleSubmit(event) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		onSubmit({
			title: String(formData.get("title")).trim(),
			sku: String(formData.get("sku")).trim(),
			category: String(formData.get("category")),
			price: Number(formData.get("price")),
			lowStockThreshold: Number(formData.get("lowStockThreshold"))
		});
	}

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby="dialog-title"
			onClose={onClose}
			onClick={(event) => {
				if (event.target === dialogRef.current) onClose();
			}}
		>
			<form ref={formRef} className="dialog-content" onSubmit={handleSubmit}>
				<div className="dialog-header">
					<h2 id="dialog-title">Add a product</h2>
					<button className="close-button" type="button" onClick={onClose} aria-label="Close dialog">×</button>
				</div>
				<div className="form-grid">
					<div className="form-field wide">
						<label htmlFor="new-title">Product name</label>
						<input id="new-title" name="title" required maxLength="100" placeholder="e.g. Ceramic mug" />
					</div>
					<div className="form-field">
						<label htmlFor="new-sku">Product code (SKU)</label>
						<input id="new-sku" name="sku" required maxLength="32" placeholder="e.g. MUG-001" />
					</div>
					<div className="form-field">
						<label htmlFor="new-category">Category</label>
						<select id="new-category" name="category" required>
							{categories.map((category) => <option key={category} value={category}>{category.replaceAll("-", " ")}</option>)}
						</select>
					</div>
					<div className="form-field">
						<label htmlFor="new-price">Price ($)</label>
						<input id="new-price" name="price" type="number" min="0" step="0.01" required placeholder="0.00" />
					</div>
					<div className="form-field">
						<label htmlFor="new-threshold">Low-stock alert at</label>
						<input id="new-threshold" name="lowStockThreshold" type="number" min="0" step="1" defaultValue="10" required />
					</div>
				</div>
				<p className="form-hint">New products start at 0 stock. Use “Manage stock” to record a receipt.</p>
				{error && <p className="form-error" role="alert">{error}</p>}
				<div className="dialog-actions">
					<button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
					<button className="primary-button" type="submit" disabled={saving}>
						{saving ? "Adding…" : "Create product"}
					</button>
				</div>
			</form>
		</dialog>
	);
}
