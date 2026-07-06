(() => {
  "use strict";

  // Só roda o app se alguém estiver logado. A tela de login (auth.js) cuida
  // do resto; sem usuário, não montamos nada. Cada pessoa tem seus próprios
  // itens, guardados numa chave separada por usuário.
  const SESSION_KEY = "wishboard:currentUser";
  const currentUser = localStorage.getItem(SESSION_KEY);
  if (!currentUser) return;

  const STORAGE_KEY = "productWishlist:items:v2:" + currentUser;
  const CATEGORIES_STORAGE_KEY = "productWishlist:categories:v1:" + currentUser;
  const MICROLINK_ENDPOINT = "https://api.microlink.io/";
  const FETCH_TIMEOUT_MS = 8000;
  const PROTECTED_CATEGORY_KEY = "geral"; // fallback target throughout the app — never deletable

  const DEFAULT_CATEGORIES = [
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
    { key: "diversao", label: "Diversão" },
    { key: "alimentos", label: "Alimentos" },
  ];
  const ALL_KEY = "todas";

  function loadCategories() {
    try {
      const raw = window.localStorage.getItem(CATEGORIES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    } catch (err) {
      return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
  }

  function saveCategories(categories) {
    try {
      window.localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
    } catch (err) {
      // Categories just won't persist across reloads if storage is unavailable.
    }
  }

  let CATEGORIES = loadCategories();

  function isValidCategoryKey(key) {
    return CATEGORIES.some((c) => c.key === key);
  }

  // Turns a typed label into a stable, URL/id-safe key: strip accents, lowercase,
  // collapse everything else to hyphens. Falls back to a random id if that
  // leaves nothing usable, and de-dupes against existing keys.
  function slugify(label) {
    const base = label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-+|-+$)/g, "");
    let key = base || uid();
    let n = 2;
    while (CATEGORIES.some((c) => c.key === key)) {
      key = `${base || "categoria"}-${n++}`;
    }
    return key;
  }

  function addCategory(label) {
    const trimmed = label.trim();
    if (!trimmed) return;
    if (CATEGORIES.some((c) => c.label.toLowerCase() === trimmed.toLowerCase())) {
      alert("Essa categoria já existe.");
      return;
    }
    CATEGORIES.push({ key: slugify(trimmed), label: trimmed });
    saveCategories(CATEGORIES);
  }

  function renameCategory(key, newLabel) {
    const cat = CATEGORIES.find((c) => c.key === key);
    const trimmed = newLabel.trim();
    if (!cat || !trimmed) return;
    cat.label = trimmed;
    saveCategories(CATEGORIES);
  }

  function deleteCategory(key) {
    if (key === PROTECTED_CATEGORY_KEY) return;

    const affected = items.filter((item) => item.category === key);
    if (affected.length) {
      const ok = confirm(
        `${affected.length} item(ns) usam essa categoria. Eles serão movidos para "Geral". Continuar?`
      );
      if (!ok) return;
      affected.forEach((item) => {
        item.category = PROTECTED_CATEGORY_KEY;
      });
      saveItems(items);
    }

    CATEGORIES = CATEGORIES.filter((c) => c.key !== key);
    saveCategories(CATEGORIES);
    selectedFilters.delete(key);
  }

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

  // Accepts "R$2.041,55", "2041,55", "2041.55" or "2041" — strips any currency
  // symbol/spaces, and treats "," as the decimal separator whenever it's
  // present (Brazilian format), falling back to "." otherwise.
  function parsePriceInput(raw) {
    const cleaned = raw.replace(/[^\d,.]/g, "").trim();
    if (!cleaned) return NaN;
    const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
    return parseFloat(normalized);
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

  // ---------- Category select setup (for assigning an item; rebuilt whenever categories change) ----------

  const todasBtn = document.getElementById("todasBtn");
  const subcatNav = document.getElementById("subcatNav");
  const categoryInput = document.getElementById("categoryInput");

  function renderCategorySelect() {
    const previousValue = categoryInput.value;
    categoryInput.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat.key;
      option.textContent = cat.label;
      categoryInput.appendChild(option);
    });
    categoryInput.value = isValidCategoryKey(previousValue) ? previousValue : PROTECTED_CATEGORY_KEY;
  }

  renderCategorySelect();

  // ---------- Rendering ----------

  const cardTemplate = document.getElementById("cardTemplate");
  const itemCountEl = document.getElementById("itemCount");
  const itemTotalEl = document.getElementById("itemTotal");
  const catGrid = document.getElementById("catGrid");

  // Empty set = "Todas" (no filter, show everything). Any keys present = show
  // the union of those categories; picking more than one is allowed.
  let selectedFilters = new Set();

  function isIncludedInTotal(item) {
    return item.includeInTotal !== false;
  }

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
    const dragBtn = node.querySelector(".card-drag");

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

    setCardIncludedVisual(node, isIncludedInTotal(item));

    // Native drag-and-drop lets you start a drag from anywhere on a
    // draggable element — arm it only while the handle is actually pressed
    // so the rest of the card (links, buttons) stays click-only.
    const arm = () => {
      node.draggable = true;
    };
    const disarm = () => {
      node.draggable = false;
    };
    dragBtn.addEventListener("mousedown", arm);
    dragBtn.addEventListener("touchstart", arm, { passive: true });
    dragBtn.addEventListener("mouseup", disarm);
    node.addEventListener("dragend", disarm);

    return node;
  }

  function setCardIncludedVisual(cardNode, included) {
    // The `hidden` IDL property doesn't reliably reflect to the attribute (or
    // affect rendering) on real SVG elements in every browser — toggle the
    // inline style directly instead, which works for any element type.
    const eyeIcon = cardNode.querySelector(".icon-eye");
    const eyeOffIcon = cardNode.querySelector(".icon-eye-off");
    eyeIcon.style.display = included ? "" : "none";
    eyeOffIcon.style.display = included ? "none" : "";
    cardNode.classList.toggle("card--excluded", !included);
  }

  // Inner filter row shown below the top bar: "Todas" plus every category,
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

    const manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className = "manage-categories-btn";
    manageBtn.title = "Gerenciar categorias";
    manageBtn.setAttribute("aria-label", "Gerenciar categorias");
    manageBtn.textContent = "⚙";
    subcatNav.appendChild(manageBtn);

    todasBtn.classList.toggle("active", selectedFilters.size === 0);
  }

  // The list currently shown in the canvas, in display order. Sorting by a
  // single shared `order` field (instead of switching sort keys per view)
  // means drag-and-drop and the move arrows both just reposition items
  // within whichever subset is visible right now — single category,
  // several at once, or everything under "Todas".
  function getVisibleItems() {
    const list = selectedFilters.size === 0 ? [...items] : items.filter((item) => selectedFilters.has(item.category));
    return list.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function renderCategoryPanel() {
    const showMove = selectedFilters.size === 1;
    const catItems = getVisibleItems();

    catGrid.innerHTML = "";
    catItems.forEach((item) => catGrid.appendChild(buildCard(item, showMove)));
  }

  function updateSummary() {
    itemCountEl.textContent = `${items.length} ${items.length === 1 ? "item" : "itens"}`;
    const total = items.reduce(
      (sum, item) => sum + (isIncludedInTotal(item) ? Number(item.price) || 0 : 0),
      0
    );
    itemTotalEl.textContent = formatPrice(total);
  }

  function renderAll() {
    updateSummary();
    renderSubcatNav();
    renderCategoryPanel();
  }

  // ---------- Filters ----------
  // The canvas is always visible — there is no collapsed/empty state other
  // than "this filter genuinely has no items". "Todas" just clears whatever
  // categories are selected, same as picking "Todas" inside the filter row.

  function resetToAll() {
    selectedFilters.clear();
    renderSubcatNav();
    renderCategoryPanel();
  }

  todasBtn.addEventListener("click", resetToAll);

  subcatNav.addEventListener("click", (e) => {
    if (e.target.closest(".manage-categories-btn")) {
      openCategoryModal();
      return;
    }

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
    const editBtn = e.target.closest(".card-edit");
    const upBtn = e.target.closest(".card-move-up");
    const downBtn = e.target.closest(".card-move-down");
    const toggleBtn = e.target.closest(".card-toggle-total");
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;

    if (removeBtn) {
      if (!confirm("Remover este item da lista?")) return;
      items = items.filter((item) => item.id !== id);
      saveItems(items);
      renderAll();
    } else if (editBtn) {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      openEditModal(item);
    } else if (upBtn) {
      moveItem(id, -1);
    } else if (downBtn) {
      moveItem(id, 1);
    } else if (toggleBtn) {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      item.includeInTotal = !isIncludedInTotal(item);
      saveItems(items);
      setCardIncludedVisual(card, isIncludedInTotal(item));
      updateSummary();
    }
  });

  // ---------- Drag-and-drop reordering ----------
  // Dragging repositions the item within whichever list is currently visible
  // (one category, several, or "Todas") by nudging just its `order` value
  // between its new neighbors — nothing outside that visible set is touched.

  let draggedId = null;

  catGrid.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    draggedId = card.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggedId);
    card.classList.add("dragging");
  });

  catGrid.addEventListener("dragend", (e) => {
    const card = e.target.closest(".card");
    if (card) card.classList.remove("dragging");
    catGrid.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    draggedId = null;
  });

  catGrid.addEventListener("dragover", (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const overCard = e.target.closest(".card");
    catGrid.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    if (overCard && overCard.dataset.id !== draggedId) {
      overCard.classList.add("drag-over");
    }
  });

  catGrid.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetCard = e.target.closest(".card");
    catGrid.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    if (!draggedId || !targetCard || targetCard.dataset.id === draggedId) return;

    const list = getVisibleItems();
    const fromIndex = list.findIndex((item) => item.id === draggedId);
    const toIndex = list.findIndex((item) => item.id === targetCard.dataset.id);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);

    const newIndex = list.indexOf(moved);
    const prev = list[newIndex - 1];
    const next = list[newIndex + 1];
    if (prev && next) moved.order = (prev.order + next.order) / 2;
    else if (prev) moved.order = prev.order + 1;
    else if (next) moved.order = next.order - 1;

    saveItems(items);
    renderCategoryPanel();
  });

  // ---------- Modal (doubles as both "Adicionar item" and "Editar item") ----------

  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitleEl = document.getElementById("modalTitle");
  const submitItemBtn = document.getElementById("submitItemBtn");
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

  // null while adding a new item; the item's id while editing an existing one.
  let editingItemId = null;

  function openAddModal() {
    editingItemId = null;
    addForm.reset();
    previewBox.hidden = true;
    modalTitleEl.textContent = "Adicionar item";
    submitItemBtn.textContent = "Adicionar";
    modalOverlay.hidden = false;
  }

  function openEditModal(item) {
    editingItemId = item.id;
    urlInput.value = item.url;
    titleInput.value = item.title;
    descInput.value = item.description || "";
    imageInput.value = item.image || "";
    categoryInput.value = item.category;
    priceInput.value = formatPrice(item.price);
    modalTitleEl.textContent = "Editar item";
    submitItemBtn.textContent = "Salvar";
    modalOverlay.hidden = false;
    updatePreview();
  }

  function closeModal() {
    modalOverlay.hidden = true;
    editingItemId = null;
    addForm.reset();
    fetchStatus.textContent = "";
    previewBox.hidden = true;
  }

  document.getElementById("openAddBtn").addEventListener("click", openAddModal);
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

    fetchStatus.textContent = "Buscando dados do produto...";
    fetchBtn.disabled = true;

    try {
      const meta = await fetchMetadata(url);
      if (meta.title) titleInput.value = meta.title;
      if (meta.description) descInput.value = meta.description;
      if (meta.image) imageInput.value = meta.image;
      updatePreview();
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
    const price = parsePriceInput(priceInput.value);

    if (!url || !title || Number.isNaN(price)) return;

    const category = isValidCategoryKey(categoryInput.value) ? categoryInput.value : PROTECTED_CATEGORY_KEY;
    const description = descInput.value.trim();
    const image = imageInput.value.trim();

    if (editingItemId) {
      const existing = items.find((i) => i.id === editingItemId);
      if (!existing) return;
      existing.url = url;
      existing.title = title;
      existing.description = description;
      existing.image = image;
      existing.category = category;
      existing.price = price;
      saveItems(items);
    } else {
      // New items sort to the top of whatever list they land in — one less
      // than the current lowest order value, so ascending sort puts it first.
      const lowestOrder = items.length ? Math.min(...items.map((i) => i.order || 0)) : Date.now();

      const item = {
        id: uid(),
        url,
        title,
        description,
        image,
        category,
        price,
        addedAt: Date.now(),
        order: lowestOrder - 1,
        includeInTotal: true,
      };

      items.push(item);
      saveItems(items);
    }

    // If a filter is active and doesn't already include this item's category,
    // add it so the item stays visible; "Todas" (empty selection) just stays
    // put since the item already belongs to the aggregate list.
    if (selectedFilters.size > 0) {
      selectedFilters.add(category);
    }

    renderSubcatNav();
    renderCategoryPanel();
    updateSummary();

    closeModal();
  });

  // ---------- Category management modal ----------

  const categoryModalOverlay = document.getElementById("categoryModalOverlay");
  const categoryManageList = document.getElementById("categoryManageList");
  const newCategoryInput = document.getElementById("newCategoryInput");
  const addCategoryBtn = document.getElementById("addCategoryBtn");

  function renderCategoryManageList() {
    categoryManageList.innerHTML = "";
    CATEGORIES.forEach((cat) => {
      const row = document.createElement("div");
      row.className = "category-row";
      row.dataset.key = cat.key;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "category-label-input";
      input.value = cat.label;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "category-delete-btn";
      deleteBtn.textContent = "Excluir";
      if (cat.key === PROTECTED_CATEGORY_KEY) {
        deleteBtn.disabled = true;
        deleteBtn.title = "Categoria padrão, não pode ser excluída";
      }

      row.appendChild(input);
      row.appendChild(deleteBtn);
      categoryManageList.appendChild(row);
    });
  }

  function refreshAfterCategoryChange() {
    renderCategorySelect();
    renderSubcatNav();
    renderCategoryPanel();
    updateSummary();
  }

  function openCategoryModal() {
    renderCategoryManageList();
    newCategoryInput.value = "";
    categoryModalOverlay.hidden = false;
  }

  function closeCategoryModal() {
    categoryModalOverlay.hidden = true;
  }

  document.getElementById("closeCategoryModalBtn").addEventListener("click", closeCategoryModal);
  categoryModalOverlay.addEventListener("click", (e) => {
    if (e.target === categoryModalOverlay) closeCategoryModal();
  });

  function submitNewCategory() {
    addCategory(newCategoryInput.value);
    newCategoryInput.value = "";
    newCategoryInput.focus();
    renderCategoryManageList();
    refreshAfterCategoryChange();
  }

  addCategoryBtn.addEventListener("click", submitNewCategory);
  newCategoryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNewCategory();
    }
  });

  categoryManageList.addEventListener("change", (e) => {
    const input = e.target.closest(".category-label-input");
    if (!input) return;
    const key = input.closest(".category-row").dataset.key;
    renameCategory(key, input.value);
    refreshAfterCategoryChange();
  });

  categoryManageList.addEventListener("click", (e) => {
    const btn = e.target.closest(".category-delete-btn");
    if (!btn || btn.disabled) return;
    const key = btn.closest(".category-row").dataset.key;
    deleteCategory(key);
    renderCategoryManageList();
    refreshAfterCategoryChange();
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
            category: isValidCategoryKey(item.category) ? item.category : PROTECTED_CATEGORY_KEY,
            price: Number(item.price) || 0,
            addedAt: item.addedAt || Date.now(),
            order: Number(item.order) || Number(item.addedAt) || Date.now() + index,
            includeInTotal: item.includeInTotal !== false,
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
  // The canvas always starts showing every item ("Todas") — it should never
  // come up empty unless the app genuinely has zero items.

  renderAll();
})();
