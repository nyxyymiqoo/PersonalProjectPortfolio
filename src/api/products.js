const API_BASE_URL = (
  import.meta.env.VITE_API_URL || ""
).replace(/\/+$/, "");

class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;

    throw new Error(
      "Could not reach the inventory server. Check your connection and try again."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The inventory server returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new ApiError(
      data.error?.message ||
        `The inventory server returned ${response.status}.`,
      response.status,
      data.error?.code,
      data.error?.details
    );
  }

  return data;
}

export async function fetchProducts(signal) {
  const data = await request("/api/products", { signal });
  return data.products;
}

export async function fetchMovements(signal) {
  const data = await request("/api/movements", { signal });
  return data.movements;
}

export async function createProduct(product) {
  const data = await request("/api/products", {
    method: "POST",
    body: JSON.stringify(product)
  });

  return data.product;
}

export async function createStockMovement(
  id,
  movement,
  idempotencyKey
) {
  return request(`/api/products/${id}/movements`, {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(movement)
  });
}