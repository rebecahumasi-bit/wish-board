(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Login simples baseado em localStorage.
  //
  // ATENÇÃO (segurança): isto NÃO é um login seguro de verdade. Contas e dados
  // ficam salvos apenas no navegador deste computador. As senhas são guardadas
  // com hash (SHA-256), mas qualquer pessoa com acesso a este navegador e algum
  // conhecimento técnico consegue contornar. Use só para conteúdo não sensível.
  // ---------------------------------------------------------------------------

  const USERS_KEY = "wishboard:users";
  const SESSION_KEY = "wishboard:currentUser";

  const overlay = document.getElementById("authOverlay");
  const form = document.getElementById("authForm");
  const userInput = document.getElementById("authUser");
  const passInput = document.getElementById("authPass");
  const errorEl = document.getElementById("authError");
  const titleEl = document.getElementById("authTitle");
  const submitBtn = document.getElementById("authSubmit");
  const toggleBtn = document.getElementById("authToggle");
  const toggleText = document.getElementById("authToggleText");
  const userBadge = document.getElementById("currentUserName");
  const logoutBtn = document.getElementById("logoutBtn");

  let mode = "login"; // "login" ou "signup"

  // ---------- Persistência das contas ----------

  function loadUsers() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  // Guarda a senha como hash SHA-256 em vez de texto puro.
  async function hashPassword(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function showError(msg) {
    errorEl.textContent = msg || "";
  }

  // ---------- Alternar entre "Entrar" e "Criar conta" ----------

  function setMode(next) {
    mode = next;
    if (mode === "login") {
      titleEl.textContent = "Entrar";
      submitBtn.textContent = "Entrar";
      toggleText.textContent = "Não tem uma conta?";
      toggleBtn.textContent = "Criar conta";
      passInput.autocomplete = "current-password";
    } else {
      titleEl.textContent = "Criar conta";
      submitBtn.textContent = "Criar conta";
      toggleText.textContent = "Já tem uma conta?";
      toggleBtn.textContent = "Entrar";
      passInput.autocomplete = "new-password";
    }
    showError("");
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      setMode(mode === "login" ? "signup" : "login");
      userInput.focus();
    });
  }

  // ---------- Enviar o formulário (login ou cadastro) ----------

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = userInput.value.trim().toLowerCase();
      const password = passInput.value;

      if (!username || !password) {
        showError("Preencha usuário e senha.");
        return;
      }
      if (password.length < 4) {
        showError("A senha precisa ter pelo menos 4 caracteres.");
        return;
      }

      submitBtn.disabled = true;
      try {
        const users = loadUsers();
        const pwHash = await hashPassword(password);

        if (mode === "signup") {
          if (users[username]) {
            showError("Esse usuário já existe. Tente entrar.");
            return;
          }
          users[username] = { password: pwHash, createdAt: Date.now() };
          saveUsers(users);
          localStorage.setItem(SESSION_KEY, username);
          location.reload();
        } else {
          if (!users[username] || users[username].password !== pwHash) {
            showError("Usuário ou senha incorretos.");
            return;
          }
          localStorage.setItem(SESSION_KEY, username);
          location.reload();
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ---------- Sair ----------

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    });
  }

  // ---------- Decidir o que mostrar ao carregar a página ----------

  const currentUser = localStorage.getItem(SESSION_KEY);
  if (currentUser) {
    // Logado: esconde o login, mostra o app.
    if (overlay) overlay.hidden = true;
    document.body.classList.add("logged-in");
    if (userBadge) userBadge.textContent = currentUser;
  } else {
    // Deslogado: mostra a tela de login por cima de tudo.
    if (overlay) overlay.hidden = false;
    document.body.classList.remove("logged-in");
    setMode("login");
    if (userInput) userInput.focus();
  }
})();
