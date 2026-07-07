(() => {
  "use strict";

  // Dois modos de armazenamento (ver auth.js):
  //  - "local": contas comuns de outras pessoas -> dados no localStorage do
  //     navegador, separados por usuário (comportamento antigo).
  //  - "cloud": a conta CONJUNTA (só nós) -> dados na NUVEM (Supabase), numa
  //     única linha compartilhada, sincronizada entre dispositivos.
  const BOARD_ID = "shared";
  const MODE = localStorage.getItem("wishboard:mode"); // "local" | "cloud" | null
  const currentUser = localStorage.getItem("wishboard:currentUser");
  const isCloud = MODE === "cloud";
  const STORAGE_KEY = currentUser ? "productWishlist:items:v2:" + currentUser : null;
  const CATEGORIES_STORAGE_KEY = currentUser ? "productWishlist:categories:v1:" + currentUser : null;
  const MICROLINK_ENDPOINT = "https://api.microlink.io/";
  // Microlink scrapes the target page server-side on a cache miss, which can
  // easily take longer than a few seconds for heavier pages — 8s was cutting
  // that off before the first (uncached) request finished, so a first click
  // would silently fail and only the second click (now cached) would work.
  const FETCH_TIMEOUT_MS = 20000;
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

  // Começa com as categorias padrão; a nuvem substitui assim que carregar.
  // saveCategories() está definido no bloco de armazenamento (envia pra nuvem).
  let CATEGORIES = DEFAULT_CATEGORIES.map((c) => ({ ...c }));

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

  // ---------- Armazenamento (local OU nuvem, conforme o modo) ----------
  // items e CATEGORIES ficam em memória; saveItems/saveCategories aceitam
  // argumento por compatibilidade, mas sempre gravam o estado atual.

  let items = [];
  let saveTimer = null;

  function saveBoard() {
    if (isCloud) {
      if (!window.sb) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        window.sb
          .from("board")
          .update({
            items: items,
            categories: CATEGORIES,
            updated_at: new Date().toISOString(),
          })
          .eq("id", BOARD_ID)
          .then(({ error }) => {
            if (error) console.error("Erro ao salvar na nuvem:", error);
          });
      }, 400);
    } else if (STORAGE_KEY) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(CATEGORIES));
      } catch (err) {
        /* sem persistência se o localStorage estiver bloqueado */
      }
    }
  }

  function saveItems() {
    saveBoard();
  }

  function saveCategories() {
    saveBoard();
  }

  // Contas locais carregam os dados imediatamente do localStorage.
  // A conta conjunta (nuvem) carrega no bloco "Nuvem", no fim do arquivo.
  if (!isCloud && STORAGE_KEY) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) items = arr;
    } catch (err) {
      /* ignora */
    }
    try {
      const rawC = localStorage.getItem(CATEGORIES_STORAGE_KEY);
      const parsed = rawC ? JSON.parse(rawC) : null;
      if (Array.isArray(parsed) && parsed.length) CATEGORIES = parsed;
    } catch (err) {
      /* ignora */
    }
  }

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

  // ---------- Title fallback chain: OG metadata -> URL slug -> domain name ----------
  // Note on scope: turning "ASPIRADOR-PAS4000V-..." into "Aspirador de Pó..."
  // needs real product knowledge (knowing "aspirador" commonly means "aspirador
  // de pó" in PT-BR) — that's semantic inference, not string parsing, and this
  // is a static site with no language model to call. What follows is the best
  // *deterministic* approximation: strip tracking/id noise, keep real words and
  // model-code tokens, and title-case the result.

  // A blocked/antibot page often "succeeds" but hands back just the brand name
  // (or a generic challenge-page title) instead of the actual product — treat
  // that as if metadata had failed so the URL-based fallback kicks in instead.
  const GENERIC_TITLE_PATTERNS = new Set([
    "mercado livre",
    "mercado libre",
    "amazon.com",
    "amazon.com.br",
    "amazon",
    "shopee",
    "aliexpress.com",
    "aliexpress",
    "magazine luiza",
    "americanas.com",
    "americanas",
    "just a moment...",
    "attention required! | cloudflare",
    "access denied",
    "robot check",
  ]);

  function looksGenericTitle(title) {
    if (!title || !title.trim()) return true;
    return GENERIC_TITLE_PATTERNS.has(title.trim().toLowerCase());
  }

  // Path segments that are pure e-commerce routing noise, never product words.
  const URL_NOISE_SEGMENTS = new Set([
    "dp", "gp", "product", "products", "produto", "produtos", "item", "itens",
    "p", "pd", "sku", "ref", "detail", "details", "d", "ip", "prod", "buy",
  ]);

  // A pure-digit token (price, quantity, plain numeric id) or a long letter+
  // digit blob with no vowels (ASIN-like "B088MVWBM9") is noise; a token that
  // mixes letters and digits AND reads like a word ("PAS4000V") is a model
  // number worth keeping.
  function looksLikeIdToken(word) {
    if (/^\d+$/.test(word)) return true;
    if (/^[a-z0-9]{6,}$/i.test(word) && /\d/.test(word) && !/[aeiouáéíóúâêôãõ]/i.test(word)) {
      return true;
    }
    return false;
  }

  function titleCaseWord(word) {
    if (/[a-z]/i.test(word) && /\d/.test(word)) return word; // model code — keep as-is
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  function titleFromUrlPath(url) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(url).pathname);
    } catch (err) {
      return "";
    }

    const words = pathname
      .split("/")
      .filter(Boolean)
      .filter((segment) => !URL_NOISE_SEGMENTS.has(segment.toLowerCase()))
      .flatMap((segment) => segment.split(/[-_]+/))
      .filter(Boolean)
      .filter((word) => !looksLikeIdToken(word))
      .filter((word) => !URL_NOISE_SEGMENTS.has(word.toLowerCase()))
      .slice(0, 12); // keep generated titles reasonable even for very long SEO slugs

    return words.length ? words.map(titleCaseWord).join(" ") : "";
  }

  const DOMAIN_DISPLAY_NAMES = {
    "amazon.com.br": "Amazon",
    "amazon.com": "Amazon",
    "mercadolivre.com.br": "Mercado Livre",
    "mercadolibre.com": "Mercado Livre",
    "shopee.com.br": "Shopee",
    "aliexpress.com": "AliExpress",
    "magazineluiza.com.br": "Magazine Luiza",
    "americanas.com.br": "Americanas",
    "casasbahia.com.br": "Casas Bahia",
  };

  // Last resort so a title is never left blank: the site's brand name, or the
  // first label of its domain if we don't recognize it.
  function domainDisplayName(domain) {
    if (!domain) return "Produto";
    const bare = domain.replace(/^www\./, "");
    if (DOMAIN_DISPLAY_NAMES[bare]) return DOMAIN_DISPLAY_NAMES[bare];
    const label = bare.split(".")[0];
    return label ? titleCaseWord(label) : "Produto";
  }

  function resolveTitle(meta, url) {
    if (!looksGenericTitle(meta.title)) return meta.title;
    return titleFromUrlPath(url) || domainDisplayName(getDomain(url));
  }

  // ---------- Category inference from title/description/URL keywords ----------

  const CATEGORY_KEYWORDS = {
    limpeza: ["aspirador", "vassoura", "detergente", "sabao", "rodo", "esponja", "desinfetante", "alvejante", "multiuso", "amaciante"],
    cozinha: ["panela", "frigideira", "liquidificador", "fogao", "forno", "talher", "cozinha", "airfryer", "air fryer", "faca", "batedeira", "cafeteira", "utensilio"],
    tecnologia: ["celular", "smartphone", "notebook", "computador", "televisao", " tv ", "fone", "airpods", "earbud", "bluetooth", "headset", "mouse", "teclado", "tablet", "camera", "eletronico", "informatica", "carregador", "ssd", "processador", "monitor", "impressora", "roteador", "hd externo"],
    moveis: ["sofa", "cadeira", "mesa", "cama", "armario", "estante", "guarda-roupa", "guarda roupa", "rack", "poltrona", "colchao", "movel", "moveis"],
    roupas: ["camisa", "camiseta", "calca", "vestido", "jaqueta", "blusa", "short", "bermuda", "casaco", "moletom", "roupa", "meia", "cueca", "sutia"],
    "saude-beleza": ["perfume", "maquiagem", "batom", "creme", "shampoo", "condicionador", "hidratante", "protetor solar", "beleza", "cosmetico", "sabonete", "skincare"],
    escritorio: ["caneta", "caderno", "papel", "grampeador", "papelaria", "impressora", "mochila", "pasta", "escritorio"],
    automotivo: ["pneu", "oleo motor", "farol", "carro", "moto", "automotivo", "para-choque", "retrovisor"],
    ferramentas: ["furadeira", "parafusadeira", "chave de fenda", "martelo", "serra", "ferramenta", "alicate", "trena", "parafuso"],
    jardinagem: ["vaso", "planta", "jardim", "adubo", "mangueira", "regador", "jardinagem", "grama"],
    pets: ["racao", "coleira", "aquario", "petisco", "cachorro", "gato", " pet "],
    esporte: ["bicicleta", "bola", "tenis", "halter", "academia", "esporte", "fitness", "corrida"],
    entretenimento: ["livro", "filme", "musica", "streaming", "quadrinho"],
    diversao: ["jogo", "brinquedo", "game", "playstation", "xbox", "nintendo", "boneca", "lego", "controle"],
    banheiro: ["toalha", "chuveiro", "vaso sanitario", "box banheiro", "tapete banheiro", "banheiro"],
    decoracao: ["quadro", "luminaria", "almofada", "tapete", "decoracao", "vela aromatica", "enfeite"],
    alimentos: ["cafe", "chocolate", "biscoito", "arroz", "feijao", "alimento", "comida", "bebida", "cerveja", "vinho"],
  };

  function stripAccents(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function inferCategory(text) {
    const normalized = stripAccents(text).toLowerCase();
    let bestKey = null;
    let bestScore = 0;

    for (const [key, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (!isValidCategoryKey(key)) continue; // may have been renamed/deleted by the user
      let score = 0;
      for (const kw of keywords) {
        if (normalized.includes(kw)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    return bestScore > 0 ? bestKey : null;
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

  function buildCard(item) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);

    const img = node.querySelector(".card-image");
    const domainEl = node.querySelector(".card-domain");
    const titleEl = node.querySelector(".card-title");
    const descEl = node.querySelector(".card-desc");
    const priceEl = node.querySelector(".card-price");
    const linkEl = node.querySelector(".card-link");
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
    const catItems = getVisibleItems();

    catGrid.innerHTML = "";
    catItems.forEach((item) => catGrid.appendChild(buildCard(item)));
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

  catGrid.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".card-remove");
    const editBtn = e.target.closest(".card-edit");
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
    // reset() picks the select's first option since none of the dynamically
    // built <option>s carry the `selected` attribute — force the intended
    // default explicitly instead of leaving it at whatever sorts first.
    categoryInput.value = PROTECTED_CATEGORY_KEY;
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
    const ocrStatusEl = document.getElementById("ocrStatus");
    if (ocrStatusEl) {
      ocrStatusEl.textContent = "";
      ocrStatusEl.classList.remove("error");
    }
    const ocrThumbEl = document.getElementById("ocrThumb");
    if (ocrThumbEl) {
      if (ocrThumbEl.dataset.url) {
        URL.revokeObjectURL(ocrThumbEl.dataset.url);
        delete ocrThumbEl.dataset.url;
      }
      ocrThumbEl.hidden = true;
      ocrThumbEl.removeAttribute("src");
    }
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

    let meta = { title: "", description: "", image: "" };
    try {
      meta = await fetchMetadata(url);
    } catch (err) {
      // Fetch failed outright — resolveTitle() below still derives something
      // from the URL itself, so the title never ends up empty.
    }

    titleInput.value = resolveTitle(meta, url);
    if (meta.description) descInput.value = meta.description;
    if (meta.image) imageInput.value = meta.image;

    const guessedCategory = inferCategory(`${titleInput.value} ${descInput.value} ${url}`);
    if (guessedCategory) categoryInput.value = guessedCategory;

    updatePreview();

    fetchStatus.textContent = "";
    fetchBtn.disabled = false;
  });

  [titleInput, imageInput, urlInput].forEach((el) => {
    el.addEventListener("input", updatePreview);
  });

  // ---------- Ler o preço a partir de um print (OCR no navegador) ----------
  // Usa o Tesseract.js (carregado por CDN no index.html). Como é a própria
  // pessoa que envia a imagem, isto NÃO depende de acessar a loja nem esbarra
  // em bloqueio de bots — só lê o texto do print e procura um valor no formato
  // de preço brasileiro (ex.: "R$ 1.234,56"). O usuário revisa antes de salvar.

  const priceOcrInput = document.getElementById("priceOcrInput");
  const ocrStatus = document.getElementById("ocrStatus");
  const ocrDropzone = document.getElementById("ocrDropzone");
  const ocrThumb = document.getElementById("ocrThumb");

  function findPriceInText(text) {
    // Normaliza espaços/tabs (mantém quebras de linha, que ajudam a separar
    // reais dos centavos sobrescritos). O "$" às vezes é lido como "S" pelo OCR,
    // por isso os padrões aceitam [\$S].
    const t = text.replace(/[ \t]+/g, " ");

    // 1) Formato com vírgula: "R$ 1.234,56" ou apenas "1.234,56".
    //    Prefere o valor que vem acompanhado de "R$".
    const comma = t.match(/(?:R\s?[\$S]\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g);
    if (comma && comma.length) {
      const withR = comma.find((s) => /R\s?[\$S]/i.test(s));
      return (withR || comma[0]).replace(/\s+/g, " ").replace(/R\s?S/i, "R$").trim();
    }

    // 2) Estilo lojas com centavos sobrescritos, SEM vírgula: "R$ 189 99".
    //    Junta os reais com os dois dígitos de centavos que vêm em seguida
    //    (separados por espaço, quebra de linha, ponto ou vírgula solta).
    const sup = t.match(/R\s?[\$S]\s*(\d{1,3}(?:\.\d{3})*)[\s.,]+(\d{2})(?!\d)/i);
    if (sup) return `R$ ${sup[1]},${sup[2]}`;

    // 3) Dígitos "grudados" depois do R$ (o OCR juntou reais e centavos),
    //    ex.: "R$18999" -> 189,99 | "R$20000" -> 200,00.
    const glued = t.match(/R\s?[\$S]\s*(\d{5,6})(?!\d)/i);
    if (glued) {
      const n = glued[1];
      return `R$ ${n.slice(0, -2)},${n.slice(-2)}`;
    }

    // 4) Só reais, sem centavos: "R$ 189".
    const only = t.match(/R\s?[\$S]\s*(\d{1,3}(?:\.\d{3})*)(?!\d)/i);
    if (only) return `R$ ${only[1]},00`;

    return null;
  }

  // Mostra uma miniatura da imagem colada/selecionada dentro da área.
  function showOcrThumb(file) {
    if (!ocrThumb) return;
    if (ocrThumb.dataset.url) URL.revokeObjectURL(ocrThumb.dataset.url);
    const url = URL.createObjectURL(file);
    ocrThumb.dataset.url = url;
    ocrThumb.src = url;
    ocrThumb.hidden = false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Decodifica um File/Blob usando a primeira, dentre várias estratégias
  // diferentes do navegador, que funcionar. Algumas fontes de imagem (ex.:
  // arrastar a miniatura flutuante de um print no Mac direto pra página, sem
  // salvar antes) fazem UM caminho específico de leitura falhar de forma
  // consistente — não é demora, é aquele código não conseguir ler aquele
  // arquivo. Só variar quando/quantas vezes tentamos não ajuda; o que ajuda é
  // tentar um jeito de ler completamente diferente.
  async function decodeFileToDrawable(file) {
    const errors = [];

    // 0) file.arrayBuffer(): força materializar os bytes de verdade em
    // memória (em vez de só guardar uma referência "promessa" ao arquivo) e
    // constrói um Blob novo, 100% local, a partir deles. Isso importa pra
    // arquivos "prometidos" pelo sistema (ex.: arrastar a miniatura de um
    // print no Mac antes de salvar em qualquer lugar) — o navegador às vezes
    // só busca os dados de verdade quando alguém pede o ArrayBuffer.
    try {
      const buffer = await file.arrayBuffer();
      const freshBlob = new Blob([buffer], { type: file.type || "image/png" });
      const url = URL.createObjectURL(freshBlob);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Falha ao carregar blob reconstruído"));
        el.src = url;
      });
      return {
        drawable: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(url),
      };
    } catch (err) {
      errors.push(err);
    }

    // 1) createImageBitmap: API mais nova, decodifica por um caminho interno
    // totalmente diferente do <img>/FileReader — normalmente a mais tolerante.
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(file);
        return { drawable: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
      } catch (err) {
        errors.push(err);
      }
    }

    // 2) <img> + URL.createObjectURL (blob:), o jeito "clássico".
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Falha ao carregar via blob URL"));
        el.src = url;
      });
      return {
        drawable: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => URL.revokeObjectURL(url),
      };
    } catch (err) {
      errors.push(err);
    }

    // 3) <img> + FileReader.readAsDataURL — outro caminho de leitura, embutindo
    // os bytes direto no src em vez de um blob: URL.
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Falha ao ler como data URL"));
        reader.readAsDataURL(file);
      });
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Falha ao carregar via data URL"));
        el.src = dataUrl;
      });
      return {
        drawable: img,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        cleanup: () => {},
      };
    } catch (err) {
      errors.push(err);
    }

    throw new Error(
      "Nenhum método de leitura funcionou: " + errors.map((e) => e.message).join(" | ")
    );
  }

  // Desenha a imagem original num canvas simples, sem nenhum tratamento.
  // Usamos isto (em vez do File/Blob direto) como entrada do Tesseract.
  const CANVAS_RETRY_DELAYS_MS = [300, 800, 1600, 3000];

  async function fileToCanvas(file, attempt = 0) {
    try {
      const { drawable, width, height, cleanup } = await decodeFileToDrawable(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(drawable, 0, 0);
        return canvas;
      } finally {
        cleanup();
      }
    } catch (err) {
      // As 4 estratégias já rodaram nesta chamada; só vale tentar de novo se
      // for mesmo o navegador ainda buscando os dados por trás de um "arquivo
      // prometido" (ex.: miniatura de print arrastada no Mac antes de salvar)
      // — isso pode levar alguns segundos, então esperamos cada vez mais.
      if (attempt >= CANVAS_RETRY_DELAYS_MS.length) throw err;
      if (ocrStatus) ocrStatus.textContent = "Ainda preparando a imagem, aguarde...";
      await sleep(CANVAS_RETRY_DELAYS_MS[attempt]);
      return fileToCanvas(file, attempt + 1);
    }
  }

  // Gera uma versão tratada (ampliada + preto e branco) da imagem, como canvas.
  // Números pequenos (como os centavos sobrescritos) ficam bem mais legíveis.
  async function fileToProcessedCanvas(file) {
    const { drawable, width: w, height: h, cleanup } = await decodeFileToDrawable(file);
    try {
      // Amplia SÓ imagens pequenas; nunca aumenta imagens já grandes
      // (evita um canvas gigante que trava o navegador e quebra o leitor).
      let scale = Math.max(1, Math.min(6, 1200 / Math.max(1, w)));
      let dw = Math.round(w * scale);
      let dh = Math.round(h * scale);
      // Limite de segurança na área total (reduz se passar disso).
      const MAX_PX = 3000000;
      if (dw * dh > MAX_PX) {
        const k = Math.sqrt(MAX_PX / (dw * dh));
        dw = Math.round(dw * k);
        dh = Math.round(dh * k);
      }
      const pad = 30;
      const canvas = document.createElement("canvas");
      canvas.width = dw + pad * 2;
      canvas.height = dh + pad * 2;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // margem branca em volta ajuda o leitor a isolar o texto
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(drawable, pad, pad, dw, dh);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      // Binariza (preto e branco puro) usando a luminância média como corte —
      // isso remove o "serrilhado" e ruído que fazem o OCR inventar dígitos.
      let sum = 0;
      const px = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
      const mean = sum / px;
      let whites = 0;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = g > mean ? 255 : 0;
        if (v === 255) whites++;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      // Garante texto escuro sobre fundo claro (inverte se o fundo era escuro).
      if (whites < px / 2) {
        for (let i = 0; i < d.length; i += 4) {
          const v = 255 - d[i];
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas;
    } finally {
      cleanup();
    }
  }

  // Roda o OCR (API simples do Tesseract, que funciona bem via CDN).
  async function ocrText(image) {
    // Passar um canvas direto pro Tesseract parece evitar o FileReader, mas
    // por dentro ele faz canvas.toBlob() e lê ESSE blob com o mesmo
    // FileReader.readAsArrayBuffer que falha com "Code=0" — ou seja, só
    // adia o problema. O único caminho que de fato não usa FileReader é uma
    // string base64 (data URL): aí ele decodifica com atob() puro.
    const source = image instanceof HTMLCanvasElement ? image.toDataURL("image/png") : image;
    const { data } = await Tesseract.recognize(source, "por", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          ocrStatus.textContent = `Lendo o print... ${Math.round(m.progress * 100)}%`;
        }
      },
    });
    return data;
  }

  // Extrai o preço usando o TAMANHO e a POSIÇÃO das palavras detectadas: os
  // reais são o maior número da imagem; os centavos, um número curto (2 dígitos)
  // menor e à direita. Dígitos soltos e pequenos (ruído) são ignorados.
  function priceFromWords(words) {
    const nums = [];
    for (const w of words || []) {
      const text = w.text || "";
      const digits = text.replace(/[^\d.]/g, "");
      if (!/\d/.test(digits)) continue;
      if (typeof w.confidence === "number" && w.confidence < 40) continue;
      const bb = w.bbox || {};
      nums.push({
        digits,
        hasComma: /,/.test(text),
        x0: bb.x0 || 0,
        x1: bb.x1 || 0,
        h: (bb.y1 || 0) - (bb.y0 || 0),
      });
    }
    if (!nums.length) return null;

    // reais = maior número (por altura) que seja um inteiro limpo (sem vírgula).
    // Se o número já tiver vírgula, é um preço completo -> deixamos o regex tratar.
    const reaisCand = nums
      .filter((n) => !n.hasComma && /^\d{1,3}(\.\d{3})*$/.test(n.digits))
      .sort((a, b) => b.h - a.h)[0];
    if (!reaisCand) return null;

    // centavos = número de 2 dígitos, menor e à direita dos reais (sobrescrito).
    const centsCand = nums
      .filter(
        (n) =>
          n !== reaisCand &&
          !n.hasComma &&
          /^\d{2}$/.test(n.digits) &&
          n.x0 >= reaisCand.x1 - reaisCand.h * 0.6 &&
          n.h <= reaisCand.h * 0.85
      )
      .sort((a, b) => a.x0 - b.x0)[0];

    // Só confiamos nesse método quando há mesmo os centavos sobrescritos;
    // caso contrário, o leitor por texto (regex) decide.
    if (!centsCand) return null;

    const reais = reaisCand.digits.replace(/\./g, "");
    const reaisFmt = reais.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `R$ ${reaisFmt},${centsCand.digits}`;
  }

  // O maior número (2+ dígitos) entre as palavras detectadas — mesmo critério
  // usado para achar os "reais" em priceFromWords, mas aqui só precisamos da
  // posição (bbox), então funciona mesmo se o texto vier com lixo colado
  // (ex.: um "R$163”" onde o Tesseract confundiu um caractere qualquer).
  function findMainNumberWord(words) {
    let best = null;
    for (const w of words || []) {
      const digits = (w.text || "").replace(/[^\d]/g, "");
      if (digits.length < 2) continue;
      if (typeof w.confidence === "number" && w.confidence < 40) continue;
      const bb = w.bbox || {};
      const h = (bb.y1 || 0) - (bb.y0 || 0);
      if (!best || h > best.h) best = { bbox: bb, h };
    }
    return best;
  }

  // Centavos sobrescritos (ex.: "R$163⁴⁰") costumam ser lidos como ruído pelo
  // Tesseract na passada normal — ele monta as linhas de texto assumindo uma
  // única base, e os dígitos pequenos e elevados ficam fora dela. Em vez de
  // tentar adivinhar configurações que resolvam isso na imagem inteira,
  // recorta especificamente a zona onde os centavos sobrescritos aparecem
  // (à direita e por cima do número principal), amplia bastante e lê só essa
  // fatia isolada — bem mais fácil pro leitor. `source` já é um canvas (saída
  // de fileToCanvas/fileToProcessedCanvas), então o recorte também é um
  // canvas — sem Blob, sem depender do FileReader do Tesseract. Qualquer
  // falha aqui é silenciosa: na pior das hipóteses, ficamos com o valor que
  // já tínhamos.
  async function ocrSuperscriptCents(source, bbox) {
    if (!bbox || !source) return null;
    try {
      const wordH = bbox.y1 - bbox.y0;
      if (!wordH || wordH < 4) return null;

      const cropX = Math.max(0, bbox.x1 - wordH * 0.6);
      const cropY = Math.max(0, bbox.y0 - wordH * 0.5);
      const cropW = source.width - cropX;
      const cropH = wordH * 1.1;
      if (cropW < 4 || cropH < 4) return null;

      const SCALE = 8;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(cropW * SCALE));
      canvas.height = Math.max(1, Math.round(cropH * SCALE));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

      // Data URL, não o canvas em si — ver o comentário em ocrText() sobre
      // por que passar um canvas direto ainda cai no FileReader problemático.
      const { data } = await Tesseract.recognize(canvas.toDataURL("image/png"), "eng", {
        tessedit_char_whitelist: "0123456789",
      });

      // Mesmo com a lista de caracteres restrita a dígitos, o leitor às vezes
      // ainda solta algum símbolo solto (aspas, apóstrofo) — por isso ignoramos
      // qualquer coisa que não seja dígito e exigimos que sobrem exatamente 2.
      // Menos que isso é "não achei nada"; mais que isso é sinal de que o
      // recorte pegou parte do número dos reais também, então descartamos.
      const digitsOnly = (data.text || "").replace(/[^\d]/g, "");
      return digitsOnly.length === 2 ? digitsOnly : null;
    } catch (err) {
      console.warn("Leitura de centavos sobrescritos falhou (ignorado):", err);
      return null;
    }
  }

  // Alguns jeitos de arrastar um arquivo (ex.: soltar direto a miniatura de
  // um print recém-tirado no Mac, sem ter salvado em nenhuma pasta) não dão
  // ao navegador um MIME type junto — "file.type" vem como string vazia
  // mesmo sendo uma imagem de verdade. Só rejeitamos quando o tipo indicado
  // é explicitamente outra coisa; sem tipo nenhum, deixamos o decodificador
  // (que tenta várias formas de ler) decidir se dá pra abrir ou não.
  function looksLikeImageFile(file) {
    if (file.type) return file.type.startsWith("image/");
    return true;
  }

  // Lê o preço de uma imagem (arquivo, colada ou arrastada).
  async function runPriceOcr(file) {
    if (!file || !ocrStatus) return;

    if (!looksLikeImageFile(file)) {
      ocrStatus.classList.add("error");
      ocrStatus.textContent = "Isso não parece uma imagem. Tente um print.";
      return;
    }
    if (typeof Tesseract === "undefined") {
      ocrStatus.classList.add("error");
      ocrStatus.textContent = "Leitor de imagem indisponível. Verifique sua conexão.";
      return;
    }

    showOcrThumb(file);
    ocrStatus.classList.remove("error");
    ocrStatus.textContent = "Lendo o print...";

    try {
      // 1ª passada: imagem ORIGINAL, desenhada num canvas e depois convertida
      // pra data URL (ver ocrText) — evita o FileReader que causa "File could
      // not be read! Code=0". fileToCanvas() já tenta de novo por conta
      // própria algumas vezes; NÃO caímos para o arquivo bruto se ainda assim
      // falhar, porque isso levaria de volta ao mesmo FileReader problemático.
      let source;
      try {
        source = await fileToCanvas(file);
      } catch (err) {
        ocrStatus.classList.add("error");
        ocrStatus.textContent =
          "Não consegui ler essa imagem ainda (comum ao arrastar direto a miniatura do print, no Mac). Espere um instante e tente de novo, ou salve o print e selecione o arquivo.";
        console.error("Falha ao carregar a imagem para OCR:", err);
        return;
      }
      let data = await ocrText(source);
      let found = priceFromWords(data.words) || findPriceInText(data.text || "");

      // 2ª passada: versão tratada (ampliada + preto e branco), também como
      // canvas, para melhorar a leitura de preços pequenos/estilizados. Se
      // der qualquer erro aqui, ignoramos e ficamos com o resultado da 1ª.
      if (!found) {
        try {
          const processed = await fileToProcessedCanvas(file);
          source = processed;
          data = await ocrText(processed);
          found = priceFromWords(data.words) || findPriceInText(data.text || "");
        } catch (err) {
          console.warn("Passada com imagem tratada falhou:", err);
        }
      }

      // Um preço "só em reais" (",00") é ambíguo: pode ser um preço redondo de
      // verdade, ou pode ser um "R$163⁴⁰" onde os centavos sobrescritos foram
      // ignorados pelo leitor. Sempre vale conferir a zona de sobrescrito antes
      // de aceitar ",00" — se não houver nada lá, o resultado não muda.
      if (found && /,00$/.test(found)) {
        const mainWord = findMainNumberWord(data.words);
        if (mainWord) {
          const cents = await ocrSuperscriptCents(source, mainWord.bbox);
          if (cents) found = found.replace(/,00$/, `,${cents}`);
        }
      }

      if (found) {
        priceInput.value = found;
        ocrStatus.classList.remove("error");
        ocrStatus.textContent = `Preço detectado: ${found}. Confira antes de salvar.`;
      } else {
        ocrStatus.classList.add("error");
        ocrStatus.textContent =
          "Não encontrei um preço. Tente recortar só a área do preço e enviar de novo, ou digite manualmente.";
      }
    } catch (err) {
      ocrStatus.classList.add("error");
      // mostra um resumo do erro para ajudar no diagnóstico, se acontecer de novo
      const detalhe = err && err.message ? ` (${String(err.message).slice(0, 80)})` : "";
      ocrStatus.textContent = `Não consegui ler o print${detalhe}. Tente uma imagem mais nítida.`;
      console.error("Erro no OCR do preço:", err);
    }
  }

  // 1) Selecionar um arquivo do computador
  if (priceOcrInput) {
    priceOcrInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) runPriceOcr(file);
      e.target.value = "";
    });
  }

  // 2) Arrastar e soltar uma imagem na área
  if (ocrDropzone) {
    ["dragenter", "dragover"].forEach((evt) =>
      ocrDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        ocrDropzone.classList.add("dragover");
      })
    );
    ["dragleave", "dragend", "drop"].forEach((evt) =>
      ocrDropzone.addEventListener(evt, () => ocrDropzone.classList.remove("dragover"))
    );
    ocrDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      let file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];

      // Algumas fontes de arraste (ex.: miniatura de print no Mac) só
      // preenchem "items", não "files" — tenta esse caminho também.
      if (!file && e.dataTransfer && e.dataTransfer.items) {
        for (const item of e.dataTransfer.items) {
          if (item.kind === "file") {
            const fromItem = item.getAsFile();
            if (fromItem) {
              file = fromItem;
              break;
            }
          }
        }
      }

      if (file) {
        runPriceOcr(file);
      } else if (ocrStatus) {
        ocrStatus.classList.add("error");
        ocrStatus.textContent =
          "Não consegui reconhecer isso como um arquivo de imagem. Tente selecionar o print pelo botão, ou colar com Cmd+V.";
      }
    });
  }

  // 3) Colar uma imagem (⌘V / Ctrl+V) enquanto o modal está aberto
  document.addEventListener("paste", (e) => {
    if (!modalOverlay || modalOverlay.hidden) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          runPriceOcr(file);
          break;
        }
      }
    }
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

  // ---------- Nuvem: carregar dados e sincronizar em tempo real ----------

  // Aplica na tela um registro vindo da nuvem (itens + categorias).
  function applyBoard(row) {
    if (!row) return;
    if (Array.isArray(row.items)) items = row.items;
    if (Array.isArray(row.categories) && row.categories.length) CATEGORIES = row.categories;
    renderCategorySelect();
    renderAll();
    if (typeof renderCategoryManageList === "function") {
      try {
        renderCategoryManageList();
      } catch (err) {
        /* a lista de categorias só existe quando o modal está aberto */
      }
    }
  }

  async function loadBoard() {
    if (!window.sb) return;
    const { data, error } = await window.sb.from("board").select("*").eq("id", BOARD_ID).single();
    if (error) {
      console.error("Erro ao carregar da nuvem:", error);
      return;
    }
    applyBoard(data);
  }

  let subscribed = false;
  function subscribeBoard() {
    if (!window.sb || subscribed) return;
    subscribed = true;
    window.sb
      .channel("board-shared")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "board", filter: `id=eq.${BOARD_ID}` },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          // Ignora se for igual ao que já temos (provavelmente o eco do nosso
          // próprio salvamento) — evita re-render desnecessário.
          const sameItems = JSON.stringify(row.items) === JSON.stringify(items);
          const sameCats = JSON.stringify(row.categories) === JSON.stringify(CATEGORIES);
          if (sameItems && sameCats) return;
          applyBoard(row);
        }
      )
      .subscribe();
  }

  async function initCloud() {
    if (!window.sb) return;
    const { data } = await window.sb.auth.getSession();
    if (data && data.session) {
      await loadBoard();
      subscribeBoard();
    }
    // Recarrega os dados quando o login acontecer nesta mesma aba.
    window.sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        loadBoard();
        subscribeBoard();
      }
    });
  }

  // Só ativa a nuvem para a conta conjunta; contas locais nem tocam o Supabase.
  if (isCloud) initCloud();
})();
