// Conexão com o Supabase (nuvem).
//
// A chave "publishable" PODE ficar pública sem problema: a segurança de verdade
// é feita pelas regras (RLS) do banco, não pela chave. Por isso é seguro num
// site estático e público. NUNCA coloque aqui a chave "secret" (sb_secret_...).

const SUPABASE_URL = "https://bftmyhxjpurcibictxha.supabase.co";
const SUPABASE_KEY = "sb_publishable_O3DPHXmuSbzOde2vwmOqXg_tRLecdQJ";

// window.supabase vem da biblioteca (carregada por CDN no index.html).
// window.sb é o nosso cliente já configurado, usado pelo auth.js e script.js.
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
