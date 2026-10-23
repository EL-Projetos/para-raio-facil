/* Para-Raio Fácil – configuração pública do acesso.
   Estes dados NÃO são secretos: a chave "anon" do Supabase foi feita para ficar no site.
   A segurança vem das regras do banco (RLS) e da função admin-usuarios, no servidor. */
window.PRF_CONFIG = {
  SUPABASE_URL: "https://ljcjzeapxedkxbxipudk.supabase.co",        // ex.: https://abcdefghijkl.supabase.co
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqY2p6ZWFweGVka3hieGlwdWRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MzMyMjgsImV4cCI6MjEwODMwOTIyOH0._OlUgvqhE7-AyUMrCOhAk_sv_I0POixTCJzdrRlmtmA",
  DOMINIO_LOGIN: "usuarios.pararaiofacil.com.br"     // use o mesmo valor na função admin-usuarios
};
