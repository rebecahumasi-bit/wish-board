(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Login HÍBRIDO:
  //
  // 1) Contas LOCAIS (padrão para outras pessoas): usuário + senha guardados no
  //    localStorage do navegador. Cada pessoa vê a lista só no próprio aparelho.
  //
  // 2) Conta CONJUNTA na nuvem (só nós): acessada digitando o e-mail secreto no
  //    campo "Usuário". Aí o login vai pro Supabase e a lista é compartilhada e
  //    sincronizada entre os nossos dispositivos. Ninguém mais sabe desse e-mail.
  // ---------------------------------------------------------------------------

  const USERS_KEY = "wishboard:users";
  const SESSION_USER_KEY = "wishboard:currentUser";
  const MODE_KEY = "wishboard:mode"; // "local" | "cloud"
  const SHARED_EMAIL = "***REMOVED***";

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

  let mode = "login"; // "login" ou "signup" (para contas locais)

  // ---------- Contas locais ----------

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

  async function hashPassword(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function showError(msg) {
    if (errorEl) errorEl.textContent = msg || "";
  }

  function setFormMode(next) {
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
      setFormMode(mode === "login" ? "signup" : "login");
      userInput.focus();
    });
  }

  // ---------- Enviar (login/cadastro) ----------

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const typed = userInput.value.trim();
      const password = passInput.value;

      if (!typed || !password) {
        showError("Preencha usuário e senha.");
        return;
      }

      // --- Caminho da conta CONJUNTA na nuvem (só quem digita o e-mail secreto) ---
      if (typed.toLowerCase() === SHARED_EMAIL.toLowerCase()) {
        if (!window.sb) {
          showError("Conexão com a nuvem indisponível. Recarregue a página.");
          return;
        }
        submitBtn.disabled = true;
        showError("");
        try {
          const { error } = await window.sb.auth.signInWithPassword({
            email: SHARED_EMAIL,
            password,
          });
          if (error) {
            showError("Usuário ou senha incorretos.");
            return;
          }
          localStorage.setItem(MODE_KEY, "cloud");
          localStorage.setItem(SESSION_USER_KEY, SHARED_EMAIL);
          location.reload();
        } catch (err) {
          showError("Não foi possível entrar. Tente de novo.");
        } finally {
          submitBtn.disabled = false;
        }
        return;
      }

      // --- Caminho das contas LOCAIS (outras pessoas) ---
      if (password.length < 4) {
        showError("A senha precisa ter pelo menos 4 caracteres.");
        return;
      }
      const username = typed.toLowerCase();
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
        } else {
          if (!users[username] || users[username].password !== pwHash) {
            showError("Usuário ou senha incorretos.");
            return;
          }
        }
        localStorage.setItem(MODE_KEY, "local");
        localStorage.setItem(SESSION_USER_KEY, username);
        location.reload();
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // ---------- Sair ----------

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const m = localStorage.getItem(MODE_KEY);
      if (m === "cloud" && window.sb) {
        try {
          await window.sb.auth.signOut();
        } catch (err) {
          /* ignora */
        }
      }
      localStorage.removeItem(SESSION_USER_KEY);
      localStorage.removeItem(MODE_KEY);
      location.reload();
    });
  }

  // ---------- Decide o que mostrar ao carregar ----------

  function showApp(label) {
    if (overlay) overlay.hidden = true;
    document.body.classList.add("logged-in");
    if (userBadge) userBadge.textContent = label || "";
  }

  function showLogin() {
    if (overlay) overlay.hidden = false;
    document.body.classList.remove("logged-in");
    setFormMode("login");
    if (userInput) userInput.focus();
  }

  (async () => {
    const m = localStorage.getItem(MODE_KEY);
    const user = localStorage.getItem(SESSION_USER_KEY);

    if (m === "cloud") {
      // Confia na sessão do Supabase (não mostra o e-mail no topo).
      const res = window.sb ? await window.sb.auth.getSession() : { data: null };
      if (res && res.data && res.data.session) {
        showApp("conta conjunta");
      } else {
        localStorage.removeItem(MODE_KEY);
        localStorage.removeItem(SESSION_USER_KEY);
        showLogin();
      }
    } else if (user) {
      showApp(user);
    } else {
      showLogin();
    }
  })();
})();
