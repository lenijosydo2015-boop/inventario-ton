/* ============================================================
   Inventário TON (web) — Reposição de senha
   Usa a mesma base de dados (Turso ou ficheiro local) do servidor.
   Uso:  node redefinir-senha.js "NOVA_SENHA" [login]
   Se não indicar senha, usa "ton2026". Se não indicar login, usa "admin".
   Para agir sobre a base na nuvem, defina antes as variáveis:
     TURSO_DATABASE_URL e TURSO_AUTH_TOKEN
   ============================================================ */
"use strict";
const bcrypt = require("bcryptjs");
const { get, all, run } = require("./db");

(async () => {
  const novaSenha = process.argv[2] && process.argv[2].trim() ? process.argv[2] : "ton2026";
  const login = process.argv[3] && process.argv[3].trim() ? process.argv[3] : "admin";

  if (novaSenha.length < 6) {
    console.error("A senha deve ter pelo menos 6 caracteres.");
    process.exit(1);
  }

  const u = await get("SELECT id, nome, login FROM usuarios WHERE lower(login)=lower(?)", login);
  if (!u) {
    console.error('Utilizador "' + login + '" nao encontrado.');
    const todos = await all("SELECT login, perfil FROM usuarios");
    console.error("Utilizadores existentes: " + todos.map(x => x.login + " (" + x.perfil + ")").join(", "));
    process.exit(1);
  }

  const hash = bcrypt.hashSync(novaSenha, 10);
  await run("UPDATE usuarios SET senhaHash=?, atualizadoEm=? WHERE id=?", hash, new Date().toISOString(), u.id);

  console.log("==============================================");
  console.log(" Senha redefinida com sucesso.");
  console.log(" Utilizador: " + u.login + "  (" + u.nome + ")");
  console.log(" Nova senha: " + novaSenha);
  console.log(" Altere-a apos entrar, em Perfil > Alterar senha.");
  console.log("==============================================");
  process.exit(0);
})().catch(e => { console.error("Erro:", e.message); process.exit(1); });
