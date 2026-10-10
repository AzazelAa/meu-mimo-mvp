const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
const CART_KEY = "meu_mimo_cart";
const ADMIN_PATH = document.body.dataset.adminPath || "/";
const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  } catch {
    return [];
  }
}

function setCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const count = getCart().reduce((sum, item) => sum + item.quantity, 0);
  document.querySelectorAll("#cart-count").forEach((node) => {
    node.textContent = String(count);
  });
}

async function loadStore() {
  const response = await fetch("/api/store");
  return response.json();
}

async function addToCart(id) {
  const cart = getCart();
  const current = cart.find((item) => item.id === id);
  if (current) current.quantity += 1;
  else cart.push({ id, quantity: 1 });
  setCart(cart);
  alert("Produto adicionado ao carrinho.");
}

async function renderCart() {
  const container = document.querySelector("#cart-items");
  if (!container) return;
  const totalNode = document.querySelector("#cart-total");
  const store = await loadStore();
  const cart = getCart();
  const items = cart.map((item) => {
    const product = store.products.find((entry) => entry.id === item.id);
    return product ? { ...item, product } : null;
  }).filter(Boolean);
  const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  totalNode.textContent = money(total);
  if (!items.length) {
    container.innerHTML = `<p>Seu carrinho esta vazio.</p>`;
    return;
  }
  container.innerHTML = items.map((item) => `
    <article class="cart-item">
      <img src="${item.product.image}" alt="${item.product.name}">
      <div>
        <strong>${item.product.name}</strong>
        <p>${item.quantity} x ${money(item.product.price)}</p>
      </div>
      <button class="remove-btn" data-remove-cart="${item.product.id}">Remover</button>
    </article>
  `).join("");
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const cart = getCart();
  if (!cart.length) {
    alert("Seu carrinho esta vazio.");
    return;
  }
  const body = {
    customerName: form.customerName.value,
    customerEmail: form.customerEmail.value,
    customerPhone: form.customerPhone.value,
    cart
  };
  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  const output = document.querySelector("#checkout-result");
  if (!response.ok) {
    output.innerHTML = `<p class="error">${result.error || "Nao foi possivel criar o pedido."}</p>`;
    return;
  }
  localStorage.removeItem(CART_KEY);
  updateCartCount();
  const qrCodeImage = result.payment.qrCodeBase64 ? `<img class="payment-qr" src="data:image/png;base64,${escapeHtml(result.payment.qrCodeBase64)}" alt="QR Code Pix">` : "";
  const ticketLink = result.payment.ticketUrl ? `<p><a class="btn secondary" href="${escapeHtml(result.payment.ticketUrl)}" target="_blank">Abrir pagamento</a></p>` : "";
  output.innerHTML = `
    <h2>Pedido criado</h2>
    <p><strong>Numero:</strong> ${result.order.id}</p>
    <p><strong>Total:</strong> ${money(result.order.total)}</p>
    <p>${result.payment.message}</p>
    ${qrCodeImage}
    <p><strong>Pix copia e cola:</strong></p>
    <textarea readonly>${escapeHtml(result.payment.pixCopyPaste || "")}</textarea>
    ${ticketLink}
  `;
}

function updateProductPreview() {
  const form = document.querySelector("#product-form");
  if (!form) return;
  const getValue = (name) => form.elements[name]?.value?.trim() || "";
  const name = getValue("name") || "Nome do item";
  const category = getValue("category") || "Categoria";
  const shortDescription = getValue("shortDescription") || "Descricao curta do mimo digital.";
  const price = getValue("price");
  const compareAtPrice = getValue("compareAtPrice");
  const image = getValue("image");

  const nameNode = document.querySelector("#preview-name");
  const categoryNode = document.querySelector("#preview-category");
  const descriptionNode = document.querySelector("#preview-description");
  const priceNode = document.querySelector("#preview-price");
  const oldPriceNode = document.querySelector("#preview-old-price");
  const imageNode = document.querySelector("#preview-image");

  if (nameNode) nameNode.textContent = name;
  if (categoryNode) categoryNode.textContent = category;
  if (descriptionNode) descriptionNode.textContent = shortDescription;
  if (priceNode) priceNode.textContent = money(price || 0);
  if (oldPriceNode) oldPriceNode.textContent = compareAtPrice ? money(compareAtPrice) : "";
  if (imageNode) {
    imageNode.textContent = image ? "" : "Imagem";
    imageNode.style.backgroundImage = image ? `url("${image}")` : "";
  }
}
async function submitAdminLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const response = await fetch("/api/internal/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
  if (response.ok) location.href = ADMIN_PATH;
  else {
    const result = await response.json().catch(() => ({}));
    alert(result.error || "Login invalido.");
  }
}

async function logoutAdmin() {
  await fetch("/api/internal/logout", { method: "POST" });
  location.href = ADMIN_PATH;
}

async function uploadProductImage(event) {
  const file = event.currentTarget.files?.[0];
  const form = document.querySelector("#product-form");
  if (!file || !form) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const response = await fetch("/api/internal/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName: file.name, dataUrl: reader.result })
    });
    const result = await response.json();
    if (!response.ok) return alert(result.error || "Erro ao enviar imagem.");
    form.elements.image.value = result.url;
    updateProductPreview();
  };
  reader.readAsDataURL(file);
}

async function submitEditProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.productId;
  const response = await fetch(`/api/internal/products/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
  if (response.ok) {
    alert("Item atualizado.");
    location.reload();
  } else {
    const result = await response.json();
    alert(result.error || "Erro ao atualizar item.");
  }
}

async function hideProduct(id) {
  if (!confirm("Ocultar este item da loja?")) return;
  const response = await fetch(`/api/internal/products/${encodeURIComponent(id)}/hide`, { method: "POST" });
  if (response.ok) location.reload();
  else alert("Erro ao ocultar item.");
}

async function submitOrderStatus(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.orderId;
  const response = await fetch(`/api/internal/orders/${encodeURIComponent(id)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form)))
  });
  if (response.ok) {
    alert("Pedido atualizado.");
    location.reload();
  } else {
    const result = await response.json();
    alert(result.error || "Erro ao atualizar pedido.");
  }
}
async function submitProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  const response = await fetch("/api/internal/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.ok) {
    alert("Produto cadastrado.");
    location.reload();
  } else {
    const result = await response.json();
    alert(result.error || "Erro ao cadastrar produto.");
  }
}

document.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-cart]");
  if (addButton) addToCart(addButton.dataset.addCart);

  const removeButton = event.target.closest("[data-remove-cart]");
  const hideButton = event.target.closest("[data-hide-product]");
  if (hideButton) hideProduct(hideButton.dataset.hideProduct);

  if (removeButton) {
    setCart(getCart().filter((item) => item.id !== removeButton.dataset.removeCart));
    renderCart();
  }
});

document.querySelector("#checkout-form")?.addEventListener("submit", submitCheckout);
document.querySelector("#admin-login-form")?.addEventListener("submit", submitAdminLogin);
document.querySelector("#logout-admin")?.addEventListener("click", logoutAdmin);
document.querySelector("#product-image-file")?.addEventListener("change", uploadProductImage);
document.querySelectorAll(".product-edit-form").forEach((form) => form.addEventListener("submit", submitEditProduct));
document.querySelectorAll(".order-status-form").forEach((form) => form.addEventListener("submit", submitOrderStatus));
document.querySelector("#product-form")?.addEventListener("submit", submitProduct);
document.querySelector("#product-form")?.addEventListener("input", updateProductPreview);
updateProductPreview();
updateCartCount();
renderCart();




