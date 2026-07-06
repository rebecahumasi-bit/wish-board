(() => {
  "use strict";

  const STORAGE_KEY = "productWishlist:items:v2";
  const MICROLINK_ENDPOINT = "https://api.microlink.io/";
  const FETCH_TIMEOUT_MS = 8000;

  const CATEGORIES = [
    { key: "moveis", label: "Móveis" },
    { key: "cozinha", label: "Cozinha" },
    { key: "banheiro", label: "Banheiro" },
    { key: "geral", label: "Geral" },
    { key: "tecnologia", label: "Tecnologia" },
    { key: "decoracao", label: "Decoração" },
    { key: "roupas", label: "Roupas" },
    { key: "limpeza", label: "Limpeza" },
    { key: "escritorio", label: "Escritório" },
    { key: "entretenimento", label: "Entretenimento" },
    { key: "saude-beleza", label: "Saúde e Beleza" },
    { key: "pets", label: "Pets" },
    { key: "esporte", label: "Esporte" },
    { key: "ferramentas", label: "Ferramentas" },
    { key: "jardinagem", label: "Jardinagem" },
    { key: "automotivo", label: "Automotivo" },
    { key: "infantil", label: "Infantil" },
    { key: "alimentos", label: "Alimentos" },
  ];
  const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
  const ALL_KEY = "todas";

  const currencyFormatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  // ---------- Storage (with graceful fallback if localStorage is blocked, e.g. inside an iframe) ----------

  let memoryItems = [];
  let storageAvailable = true;

  function testStorage() {
    try {
      const testKey = "__wishlist_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  storageAvailable = testStorage();

  function loadItems() {
    if (!storageAvailable) return memoryItems;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      return [];
    }
  }

  function saveItems(items) {
    if (!storageAvailable) {
      memoryItems = items;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      storageAvailable = false;
      memoryItems = items;
    }
  }

  let items = loadItems();

  // ---------- Helpers ----------

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (err) {
      return "";
    }
  }

  function faviconFor(domain) {
    return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : "";
  }

  function formatPrice(value) {
    const n = Number(value) || 0;
    return currencyFormatter.format(n);
  }

  // ---------- Metadata fetching (Open Graph via Microlink public API) ----------

  async function fetchMetadata(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const endpoint = `${MICROLINK_ENDPOINT}?url=${encodeURIComponent(url)}&palette=false`;
      const res = await fetch(endpoint, { signal: controller.signal });
      if (!res.ok) throw new Error("Falha na resposta da API");
      const json = await res.json();
      if (json.status !== "success" || !json.data) throw new Error("Sem dados retornados");
      const data = json.data;
      return {
        title: data.title || "",
        description: data.description || "",
        image: (data.image && data.image.url) || (data.logo && data.logo.url) || "",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Amazon and Mercado Livre run antibot protection that redirects the scraper
  // to a verification/CAPTCHA page before it ever reaches the product page —
  // no code fix on our end can get around that without a paid proxy service.
  const BLOCKED_DOMAIN_PATTERNS = [/amazon\./, /mercadolivre\./, /mercadolibre\./];

  function isKnownBlockedDomain(domain) {
    return BLOCKED_DOMAIN_PATTERNS.some((re) => re.test(domain));
  }

  // Even when the fetch "succeeds", a blocked domain often hands back the
  // verification page itself (generic brand title, cookie-notice description)
  // instead of the real product — catch that so we don't silently save junk.
  const BOT_BLOCK_TITLES = new Set([
    "mercado libre",
    "mercado livre",
    "amazon.com",
    "amazon",
    "just a moment...",
    "attention required! | cloudflare",
    "access denied",
    "robot check",
  ]);

  function looksLikeBotBlockPage(meta) {
    const title = (meta.title || "").trim().toLowerCase();
    return BOT_BLOCK_TITLES.has(title);
  }

  // ---------- Category select setup (always all 18 categories, for assigning an item) ----------

  const todasBtn = document.getElementById("todasBtn");
  const subcatNav = document.getElementById("subcatNav");
  const categoryInput = document.getElementById("categoryInput");

  CATEGORIES.forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat.key;
    option.textContent = cat.label;
    if (cat.key === "geral") option.selected = true;
    categoryInput.appendChild(option);
  });

  // ---------- Rendering ----------

  const cardTemplate = document.getElementById("cardTemplate");
  const itemCountEl = document.getElementById("itemCount");
  const itemTotalEl = document.getElementById("itemTotal");
  const catPanel = document.getElementById("catPanel");
  const catGrid = document.getElementById("catGrid");
  const hint = document.getElementById("hint");

  let panelOpen = false;
  // Empty set = "Todas" (no filter, show everything). Any keys present = show
  // the union of those categories; picking more than one is allowed.
  let selectedFilters = new Set();

  function buildCard(item, showMove) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);

    const img = node.querySelector(".card-image");
    const domainEl = node.querySelector(".card-domain");
    const titleEl = node.querySelector(".card-title");
    const descEl = node.querySelector(".card-desc");
    const priceEl = node.querySelector(".card-price");
    const linkEl = node.querySelector(".card-link");
    const upBtn = node.querySelector(".card-move-up");
    const downBtn = node.querySelector(".card-move-down");

    const domain = getDomain(item.url);
    img.src = item.image || faviconFor(domain);
    img.alt = item.title || domain;
    domainEl.textContent = domain;
    titleEl.textContent = item.title;
    descEl.textContent = item.description || "";
    priceEl.textContent = formatPrice(item.price);
    linkEl.href = item.url;
    node.dataset.id = item.id;

    if (!showMove) {
      upBtn.hidden = true;
      downBtn.hidden = true;
    }

    return node;
  }

  // Inner filter row shown inside the dropdown: "Todas" plus every category,
  // always — a category with no items yet still gets a button; picking it
  // just shows the empty state. More than one category can be active at once;
  // "Todas" means "nothing selected", so it clears the rest when clicked.
  function renderSubcatNav() {
    const entries = [{ key: ALL_KEY, label: "Todas" }, ...CATEGORIES];

    subcatNav.innerHTML = "";
    entries.forEach((cat) => {
      const isActive = cat.key === ALL_KEY ? selectedFilters.size === 0 : selectedFilters.has(cat.key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "subcat-btn" + (isActive ? " active" : "");
      btn.dataset.cat = cat.key;
      btn.textContent = cat.label;
      subcatNav.appendChild(btn);
    });
  }

  function renderCategoryPanel() {
    if (!panelOpen) {
      catGrid.innerHTML = "";
      return;
    }

    let catItems;
    const showMove = selectedFilters.size === 1;
    if (selectedFilters.size === 0) {
      catItems = [...items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    } else if (showMove) {
      const onlyKey = [...selectedFilters][0];
      catItems = items.filter((item) => item.category === onlyKey).sort((a, b) => (a.order || 0) - (b.order || 0));
    } else {
      catItems = items
        .filter((item) => selectedFilters.has(item.category))
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    catGrid.innerHTML = "";
    catItems.forEach((item) => catGrid.appendChild(buildCard(item, showMove)));
  }

  function updateSummary() {
    itemCountEl.textContent = `${items.length} ${items.length === 1 ? "item" : "itens"}`;
    const total = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    itemTotalEl.textContent = formatPrice(total);
  }

  function renderAll() {
    updateSummary();
    renderSubcatNav();
    renderCategoryPanel();
  }

  // ---------- Dropdown open/close ("Todas" is the single trigger; categories live inside it) ----------

  function openPanel() {
    panelOpen = true;
    selectedFilters.clear();
    catPanel.hidden = false;
    hint.hidden = true;
    todasBtn.classList.add("active");
    renderSubcatNav();
    renderCategoryPanel();
  }

  function closePanel() {
    panelOpen = false;
    catPanel.hidden = true;
    hint.hidden = false;
    todasBtn.classList.remove("active");
  }

  todasBtn.addEventListener("click", () => {
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  });

  subcatNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".subcat-btn");
    if (!btn) return;
    const key = btn.dataset.cat;

    if (key === ALL_KEY) {
      selectedFilters.clear();
    } else if (selectedFilters.has(key)) {
      selectedFilters.delete(key);
    } else {
      selectedFilters.add(key);
    }

    renderSubcatNav();
    renderCategoryPanel();
  });

  document.addEventListener("click", (e) => {
    if (!panelOpen) return;
    // Use composedPath() instead of e.target.closest(): card actions (move/remove)
    // rebuild catGrid synchronously while this click is still bubbling, which would
    // detach e.target and make closest() miss the still-valid ancestor chain.
    const path = e.composedPath();
    const insideRelevantArea = path.some(
      (el) => el.classList && (el.classList.contains("topbar") || el.id === "modalOverlay")
    );
    if (insideRelevantArea) return;
    closePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) closePanel();
  });

  // ---------- Card actions (remove, move) ----------

  function moveItem(id, direction) {
    const target = items.find((item) => item.id === id);
    if (!target) return;

    const catItems = items
      .filter((item) => item.category === target.category)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const idx = catItems.findIndex((item) => item.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= catItems.length) return;

    const a = catItems[idx];
    const b = catItems[swapIdx];
    const tmp = a.order;
    a.order = b.order;
    b.order = tmp;

    saveItems(items);
    renderAll();
  }

  catGrid.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".card-remove");
    const upBtn = e.target.closest(".card-move-up");
    const downBtn = e.target.closest(".card-move-down");
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;

    if (removeBtn) {
      if (!confirm("Remover este item da lista?")) return;
      items = items.filter((item) => item.id !== id);
      saveItems(items);
      renderAll();
    } else if (upBtn) {
      moveItem(id, -1);
    } else if (downBtn) {
      moveItem(id, 1);
    }
  });

  // ---------- Modal ----------

  const modalOverlay = document.getElementById("modalOverlay");
  const addForm = document.getElementById("addForm");
  const urlInput = document.getElementById("urlInput");
  const fetchBtn = document.getElementById("fetchBtn");
  const fetchStatus = document.getElementById("fetchStatus");
  const previewBox = document.getElementById("previewBox");
  const previewImage = document.getElementById("previewImage");
  const previewTitle = document.getElementById("previewTitle");
  const previewDomain = document.getElementById("previewDomain");
  const titleInput = document.getElementById("titleInput");
  const descInput = document.getElementById("descInput");
  const imageInput = document.getElementById("imageInput");
  const priceInput = document.getElementById("priceInput");

  function openModal() {
    modalOverlay.hidden = false;
  }

  function closeModal() {
    modalOverlay.hidden = true;
    addForm.reset();
    fetchStatus.textContent = "";
    previewBox.hidden = true;
  }

  document.getElementById("openAddBtn").addEventListener("click", openModal);
  document.getElementById("closeModalBtn").addEventListener("click", closeModal);
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  function updatePreview() {
    const hasTitle = titleInput.value.trim().length > 0;
    if (!hasTitle) {
      previewBox.hidden = true;
      return;
    }
    previewBox.hidden = false;
    previewImage.src = imageInput.value || faviconFor(getDomain(urlInput.value));
    previewTitle.textContent = titleInput.value;
    previewDomain.textContent = getDomain(urlInput.value);
  }

  fetchBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) return;

    // Amazon/Mercado Livre run antibot protection that blocks this entirely —
    // nothing to fetch there, so skip straight to manual entry, no message.
    const domain = getDomain(url);
    if (isKnownBlockedDomain(domain)) return;

    fetchStatus.textContent = "Buscando dados do produto...";
    fetchBtn.disabled = true;

    try {
      const meta = await fetchMetadata(url);
      // A blocked/verification page sometimes "succeeds" but hands back generic
      // junk (site name as title, cookie-notice as description) — skip it
      // rather than silently filling the form with the wrong info.
      if (!looksLikeBotBlockPage(meta)) {
        if (meta.title) titleInput.value = meta.title;
        if (meta.description) descInput.value = meta.description;
        if (meta.image) imageInput.value = meta.image;
        updatePreview();
      }
    } catch (err) {
      // Fetch failed — leave whatever fields are still empty for manual entry.
    } finally {
      fetchStatus.textContent = "";
      fetchBtn.disabled = false;
    }
  });

  [titleInput, imageInput, urlInput].forEach((el) => {
    el.addEventListener("input", updatePreview);
  });

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const url = urlInput.value.trim();
    const title = titleInput.value.trim();
    const price = parseFloat(priceInput.value);

    if (!url || !title || Number.isNaN(price)) return;

    const category = CATEGORY_KEYS.has(categoryInput.value) ? categoryInput.value : "geral";

    const item = {
      id: uid(),
      url,
      title,
      description: descInput.value.trim(),
      image: imageInput.value.trim(),
      category,
      price,
      addedAt: Date.now(),
      order: Date.now(),
    };

    items.push(item);
    saveItems(items);

    if (!panelOpen) {
      panelOpen = true;
      selectedFilters = new Set([category]);
      catPanel.hidden = false;
      hint.hidden = true;
      todasBtn.classList.add("active");
    } else if (selectedFilters.size > 0) {
      selectedFilters.add(category);
    }
    // else: panel already open on "Todas" (empty selection stays put, new item
    // just joins the aggregate list).

    renderSubcatNav();
    renderCategoryPanel();
    updateSummary();

    closeModal();
  });

  // ---------- Export / Import ----------

  document.getElementById("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lista-produtos-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error("Formato inválido");

        const existingUrls = new Set(items.map((item) => item.url));

        const merged = imported
          .filter((item) => item && typeof item.url === "string" && typeof item.title === "string")
          .filter((item) => !existingUrls.has(item.url))
          .map((item, index) => ({
            id: item.id || uid(),
            url: item.url,
            title: item.title,
            description: typeof item.description === "string" ? item.description : "",
            image: typeof item.image === "string" ? item.image : "",
            category: CATEGORY_KEYS.has(item.category) ? item.category : "geral",
            price: Number(item.price) || 0,
            addedAt: item.addedAt || Date.now(),
            order: Number(item.order) || Number(item.addedAt) || Date.now() + index,
          }));

        items = [...items, ...merged];
        saveItems(items);
        renderAll();
        alert(`${merged.length} item(ns) importado(s).`);
      } catch (err) {
        alert("Não foi possível importar este arquivo. Verifique se é um JSON exportado por esta página.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  });

  // ---------- Init ----------

  renderAll();
})();
