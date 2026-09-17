/* ============================================================
   Inventário TON — Servidor (versão WEB / nuvem)
   Node.js >= 18 · Express · base de dados Turso (libSQL, SQLite na nuvem)
   ------------------------------------------------------------
   Igual ao servidor LAN original, mas preparado para alojamento
   gratuito (Render): a base de dados vive na Turso (persistente)
   e a porta é lida de process.env.PORT.
   ============================================================ */
"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { get, all, run, exec } = require("./db");

const PORTA = process.env.PORT || process.env.PORTA || 3000;
const agora = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const PERFIS_VALIDOS = new Set(["admin", "tecnico", "responsavel", "qssa", "supervisor", "consulta"]);
const AREAS_VALIDAS = new Set(["Manutenção", "Laboratório", "QSSA", "Movimentação de Produtos", "SISE", "Informática", "Administração", "Outra"]);

const areasDoUtilizador = u => {
  try { return JSON.parse(u.areas || "[]"); } catch (e) { return []; }
};
const podeNaArea = (u, area) => {
  if (u.perfil !== "responsavel") return true;
  const areas = areasDoUtilizador(u);
  return areas.includes("*") || areas.includes(area);
};
const camposAlterados = (antes, depois, ignorar = []) => Object.keys(depois || {}).filter(k =>
  !ignorar.includes(k) && JSON.stringify(antes ? antes[k] ?? null : null) !== JSON.stringify(depois[k] ?? null));
const apenasCampos = (antes, depois, permitidos) =>
  camposAlterados(antes, depois, ["servidorEm"]).every(k => permitidos.includes(k));

/* ---------------- Esquema ---------------- */
async function criarEsquema() {
  await exec(`
CREATE TABLE IF NOT EXISTS usuarios(
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, nome TEXT, login TEXT UNIQUE,
  senhaHash TEXT, perfil TEXT, areas TEXT DEFAULT '[]', trocarSenha INTEGER DEFAULT 0,
  ativo INTEGER DEFAULT 1, criadoEm TEXT, atualizadoEm TEXT);
CREATE TABLE IF NOT EXISTS sessoes(token TEXT PRIMARY KEY, usuarioId INTEGER, criadoEm TEXT, expiraEm TEXT);
CREATE TABLE IF NOT EXISTS logins(
  id INTEGER PRIMARY KEY AUTOINCREMENT, usuarioId INTEGER, login TEXT, perfil TEXT,
  sucesso INTEGER, ip TEXT, agente TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS auditoria(
  id INTEGER PRIMARY KEY AUTOINCREMENT, usuarioId INTEGER, login TEXT, perfil TEXT,
  acao TEXT, entidade TEXT, entidadeUuid TEXT, area TEXT, detalhe TEXT, ip TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS materiais(
  uuid TEXT PRIMARY KEY, codigo TEXT UNIQUE, codBarra TEXT, nome TEXT, descricao TEXT, area TEXT,
  categoria TEXT, qtd REAL, unidade TEXT, estado TEXT, local TEXT, dataEntrada TEXT, origem TEXT,
  responsavel TEXT, valor REAL, serie TEXT, marca TEXT, foto TEXT, obs TEXT,
  criadoPor TEXT, criadoEm TEXT, atualizadoEm TEXT, servidorEm TEXT, apagado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS descartes(
  uuid TEXT PRIMARY KEY, materialUuid TEXT, codigo TEXT, nome TEXT, area TEXT, qtd REAL,
  estadoMaterial TEXT, motivo TEXT, parecerArea TEXT, parecerQSSA TEXT, fotosExtra TEXT,
  estadoPedido TEXT, dataSolicitacao TEXT, solicitante TEXT,
  atualizadoEm TEXT, servidorEm TEXT, apagado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS movimentos(
  uuid TEXT PRIMARY KEY, materialUuid TEXT, codigo TEXT, nomeMaterial TEXT, tipo TEXT,
  detalhe TEXT, usuario TEXT, data TEXT, servidorEm TEXT);
CREATE TABLE IF NOT EXISTS notificacoes(
  uuid TEXT PRIMARY KEY, paraPerfis TEXT, texto TEXT, ligacao TEXT, lidaPor TEXT DEFAULT '[]',
  data TEXT, atualizadoEm TEXT, servidorEm TEXT);
CREATE TABLE IF NOT EXISTS eliminados(
  uuid TEXT PRIMARY KEY, codigo TEXT, nome TEXT, por TEXT, data TEXT, servidorEm TEXT);
CREATE TABLE IF NOT EXISTS lances(
  uuid TEXT PRIMARY KEY, materialUuid TEXT, codigo TEXT, nomeMaterial TEXT,
  tipoPedido TEXT, valor REAL, justificacao TEXT,
  licitanteNome TEXT, licitanteArea TEXT, licitanteFuncao TEXT, licitanteLogin TEXT,
  data TEXT, atualizadoEm TEXT, servidorEm TEXT, apagado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS leiloes(
  uuid TEXT PRIMARY KEY, materialUuid TEXT, codigo TEXT, nomeMaterial TEXT, area TEXT,
  estado TEXT, tipoDecisao TEXT, lanceVencedorUuid TEXT,
  vencedorNome TEXT, vencedorArea TEXT, vencedorFuncao TEXT, valorFinal REAL,
  obs TEXT, decididoPor TEXT, decididoEm TEXT,
  atualizadoEm TEXT, servidorEm TEXT, apagado INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS movstock(
  uuid TEXT PRIMARY KEY, materialUuid TEXT, codigo TEXT, nome TEXT, tipo TEXT, qtd REAL,
  unidade TEXT, area TEXT, responsavel TEXT, motivo TEXT, foto TEXT, documento TEXT,
  qtdAntes REAL, qtdDepois REAL, usuario TEXT, data TEXT, atualizadoEm TEXT,
  servidorEm TEXT, apagado INTEGER DEFAULT 0, estornoDe TEXT);
CREATE TRIGGER IF NOT EXISTS mov_sem_update BEFORE UPDATE ON movimentos
  BEGIN SELECT RAISE(ABORT,'O histórico de movimentações é imutável.'); END;
CREATE TRIGGER IF NOT EXISTS mov_sem_delete BEFORE DELETE ON movimentos
  BEGIN SELECT RAISE(ABORT,'O histórico de movimentações é imutável.'); END;
CREATE TRIGGER IF NOT EXISTS log_sem_delete BEFORE DELETE ON logins
  BEGIN SELECT RAISE(ABORT,'O registo de acessos é imutável.'); END;
CREATE TRIGGER IF NOT EXISTS aud_sem_update BEFORE UPDATE ON auditoria
  BEGIN SELECT RAISE(ABORT,'O registo de auditoria é imutável.'); END;
CREATE TRIGGER IF NOT EXISTS aud_sem_delete BEFORE DELETE ON auditoria
  BEGIN SELECT RAISE(ABORT,'O registo de auditoria é imutável.'); END;
`);

  // Migrações para instalações existentes.
  const colsUser = new Set((await all("PRAGMA table_info(usuarios)")).map(c => c.name));
  if (!colsUser.has("areas")) await run("ALTER TABLE usuarios ADD COLUMN areas TEXT DEFAULT '[]'");
  if (!colsUser.has("trocarSenha")) await run("ALTER TABLE usuarios ADD COLUMN trocarSenha INTEGER DEFAULT 0");
  const colsLogin = new Set((await all("PRAGMA table_info(logins)")).map(c => c.name));
  if (!colsLogin.has("usuarioId")) await run("ALTER TABLE logins ADD COLUMN usuarioId INTEGER");
  if (!colsLogin.has("perfil")) await run("ALTER TABLE logins ADD COLUMN perfil TEXT");
  // Compatibilidade: os responsáveis existentes continuam operacionais até o administrador lhes atribuir áreas.
  await run("UPDATE usuarios SET areas='[\"*\"]' WHERE perfil='responsavel' AND (areas IS NULL OR areas='' OR areas='[]')");
}

/* Contas iniciais */
async function criarContasIniciais() {
  if ((await get("SELECT COUNT(*) c FROM usuarios")).c === 0) {
    const senha = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
    await run(`INSERT INTO usuarios(uuid,nome,login,senhaHash,perfil,areas,trocarSenha,criadoEm,atualizadoEm)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      uuid(), "Administrador", "admin", bcrypt.hashSync(senha, 10), "admin", "[]", 1, agora(), agora());
    console.log("Utilizador inicial criado: admin. Senha temporária: " + senha);
  }
  if ((await get("SELECT COUNT(*) c FROM usuarios WHERE perfil='supervisor'")).c === 0
      && !(await get("SELECT 1 FROM usuarios WHERE lower(login)='augusto'"))) {
    const senha = process.env.INITIAL_SUPERVISOR_PASSWORD || crypto.randomBytes(12).toString("base64url");
    await run(`INSERT INTO usuarios(uuid,nome,login,senhaHash,perfil,areas,trocarSenha,criadoEm,atualizadoEm)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      uuid(), "Augusto Nicolau", "augusto", bcrypt.hashSync(senha, 10), "supervisor", "[]", 1, agora(), agora());
    console.log("Conta inicial de Supervisor criada: augusto. Senha temporária: " + senha);
  }
}

/* ---------------- App ---------------- */
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* Pasta de imagens dos materiais (servida em /imagens).
   Por omissão usa a pasta "imagens" dentro do app; pode apontar-se outra
   com a variável de ambiente IMAGENS_DIR. */
const PASTA_IMAGENS = process.env.IMAGENS_DIR || path.join(__dirname, "imagens");
try { fs.mkdirSync(PASTA_IMAGENS, { recursive: true }); } catch (e) {}
app.use("/imagens", express.static(PASTA_IMAGENS, { fallthrough: true }));

const publicoUser = u => ({
  id: u.id, uuid: u.uuid, nome: u.nome, login: u.login, perfil: u.perfil,
  areas: areasDoUtilizador(u), trocarSenha: !!u.trocarSenha, ativo: u.ativo, criadoEm: u.criadoEm
});
const ipReal = req => req.ip || req.socket.remoteAddress || "";
async function auditar(req, acao, entidade, entidadeUuid, area, detalhe) {
  try {
    await run(`INSERT INTO auditoria(usuarioId,login,perfil,acao,entidade,entidadeUuid,area,detalhe,ip,data)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, req.usuario.id, req.usuario.login, req.usuario.perfil,
      acao, entidade || "", entidadeUuid || "", area || "", detalhe || "", ipReal(req), agora());
  } catch (e) { console.error("Falha ao auditar:", e.message); }
}

/* Autenticação por token */
async function autenticar(req, res, next) {
  try {
    const tk = (req.headers.authorization || "").replace("Bearer ", "");
    const s = tk && await get("SELECT * FROM sessoes WHERE token=?", tk);
    if (!s || s.expiraEm < agora()) return res.status(401).json({ erro: "Sessão inválida ou expirada." });
    req.usuario = await get("SELECT * FROM usuarios WHERE id=? AND ativo=1", s.usuarioId);
    if (!req.usuario) return res.status(401).json({ erro: "Utilizador inativo." });
    if (req.usuario.trocarSenha && !["/alterar-senha", "/logout", "/api/alterar-senha", "/api/logout"].includes(req.path))
      return res.status(428).json({ erro: "Deve alterar a senha temporária antes de continuar.", trocarSenha: true });
    next();
  } catch (e) {
    res.status(500).json({ erro: "Falha de autenticação: " + e.message });
  }
}
const exigirPerfil = (...perfis) => (req, res, next) =>
  perfis.includes(req.usuario.perfil) ? next() : res.status(403).json({ erro: "Sem permissão." });

/* ---------------- Sessão ---------------- */
app.post("/api/login", async (req, res) => {
  try {
    const { login, senha } = req.body || {};
    const ip = ipReal(req), agente = (req.headers["user-agent"] || "").slice(0, 180);
    const u = await get("SELECT * FROM usuarios WHERE lower(login)=lower(?) AND ativo=1", login || "");
    const ok = !!(u && bcrypt.compareSync(senha || "", u.senhaHash));
    await run("INSERT INTO logins(usuarioId,login,perfil,sucesso,ip,agente,data) VALUES(?,?,?,?,?,?,?)",
      u ? u.id : null, u ? u.login : (login || "?"), u ? u.perfil : null, ok ? 1 : 0, ip, agente, agora());
    if (!ok) return res.status(401).json({ erro: "Utilizador ou senha incorretos." });
    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 12 * 36e5).toISOString();
    await run("INSERT INTO sessoes(token,usuarioId,criadoEm,expiraEm) VALUES(?,?,?,?)", token, u.id, agora(), expira);
    res.json({ token, usuario: publicoUser(u) });
  } catch (e) {
    res.status(500).json({ erro: "Falha no início de sessão: " + e.message });
  }
});
app.post("/api/logout", autenticar, async (req, res) => {
  await run("DELETE FROM sessoes WHERE token=?", (req.headers.authorization || "").replace("Bearer ", ""));
  res.json({ ok: true });
});
app.post("/api/alterar-senha", autenticar, async (req, res) => {
  const { novaSenha } = req.body || {};
  if (!novaSenha || novaSenha.length < 10) return res.status(400).json({ erro: "A senha deve ter pelo menos 10 caracteres." });
  await run("UPDATE usuarios SET senhaHash=?, trocarSenha=0, atualizadoEm=? WHERE id=?", bcrypt.hashSync(novaSenha, 10), agora(), req.usuario.id);
  await auditar(req, "alterar_senha", "utilizador", req.usuario.uuid, "", "Senha alterada pelo próprio utilizador");
  await run("DELETE FROM sessoes WHERE usuarioId=?", req.usuario.id);
  res.json({ ok: true, reautenticar: true });
});

/* ---------------- Utilizadores (admin) ---------------- */
app.get("/api/usuarios", autenticar, exigirPerfil("admin"), async (req, res) =>
  res.json((await all("SELECT * FROM usuarios")).map(publicoUser)));
app.post("/api/usuarios", autenticar, exigirPerfil("admin"), async (req, res) => {
  const { nome, login, senha, perfil } = req.body || {};
  let { areas = [] } = req.body || {};
  if (!nome || !login || !senha || !perfil) return res.status(400).json({ erro: "Dados incompletos." });
  if (!PERFIS_VALIDOS.has(perfil)) return res.status(400).json({ erro: "Perfil inválido." });
  if (senha.length < 10) return res.status(400).json({ erro: "A senha temporária deve ter pelo menos 10 caracteres." });
  if (!Array.isArray(areas)) areas = [];
  areas = [...new Set(areas.filter(a => a === "*" || AREAS_VALIDAS.has(a)))];
  if (perfil === "qssa") areas = ["QSSA"];
  if (perfil === "responsavel" && !areas.length) return res.status(400).json({ erro: "Atribua pelo menos uma área ao responsável." });
  if (perfil !== "responsavel" && perfil !== "qssa") areas = [];
  if (await get("SELECT 1 FROM usuarios WHERE lower(login)=lower(?)", login)) return res.status(400).json({ erro: "Login já existe." });
  const novoUuidUser = uuid();
  await run("INSERT INTO usuarios(uuid,nome,login,senhaHash,perfil,areas,trocarSenha,criadoEm,atualizadoEm) VALUES(?,?,?,?,?,?,?,?,?)",
    novoUuidUser, nome, login, bcrypt.hashSync(senha, 10), perfil, JSON.stringify(areas), 1, agora(), agora());
  await auditar(req, "criar", "utilizador", novoUuidUser, areas.join(", "), `Perfil: ${perfil}`);
  res.json({ ok: true });
});
app.put("/api/usuarios/:id", autenticar, exigirPerfil("admin"), async (req, res) => {
  const id = Number(req.params.id), alvo = await get("SELECT * FROM usuarios WHERE id=?", id);
  if (!alvo) return res.status(404).json({ erro: "Utilizador não encontrado." });
  if (id === req.usuario.id && req.body.perfil && req.body.perfil !== req.usuario.perfil)
    return res.status(400).json({ erro: "Não pode alterar o seu próprio perfil." });
  const perfil = req.body.perfil || alvo.perfil;
  if (!PERFIS_VALIDOS.has(perfil)) return res.status(400).json({ erro: "Perfil inválido." });
  let areas = Array.isArray(req.body.areas) ? req.body.areas : areasDoUtilizador(alvo);
  areas = [...new Set(areas.filter(a => a === "*" || AREAS_VALIDAS.has(a)))];
  if (perfil === "qssa") areas = ["QSSA"];
  if (perfil === "responsavel" && !areas.length) return res.status(400).json({ erro: "Atribua pelo menos uma área ao responsável." });
  if (perfil !== "responsavel" && perfil !== "qssa") areas = [];
  const semAlteracao = perfil === alvo.perfil && JSON.stringify(areas) === JSON.stringify(areasDoUtilizador(alvo));
  if (semAlteracao) return res.json({ ok: true });
  await run("UPDATE usuarios SET perfil=?, areas=?, atualizadoEm=? WHERE id=?", perfil, JSON.stringify(areas), agora(), id);
  await run("DELETE FROM sessoes WHERE usuarioId=?", id);
  await auditar(req, "alterar_perfil", "utilizador", alvo.uuid, areas.join(", "), `Perfil: ${alvo.perfil} -> ${perfil}`);
  res.json({ ok: true });
});
app.post("/api/usuarios/:id/redefinir-senha", autenticar, exigirPerfil("admin"), async (req, res) => {
  const id = Number(req.params.id), alvo = await get("SELECT * FROM usuarios WHERE id=?", id);
  const senha = String((req.body || {}).senha || "");
  if (!alvo) return res.status(404).json({ erro: "Utilizador não encontrado." });
  if (senha.length < 10) return res.status(400).json({ erro: "A senha temporária deve ter pelo menos 10 caracteres." });
  await run("UPDATE usuarios SET senhaHash=?, trocarSenha=1, atualizadoEm=? WHERE id=?", bcrypt.hashSync(senha, 10), agora(), id);
  await run("DELETE FROM sessoes WHERE usuarioId=?", id);
  await auditar(req, "redefinir_senha", "utilizador", alvo.uuid, "", "Senha temporária definida; troca obrigatória no próximo acesso");
  res.json({ ok: true });
});
app.post("/api/usuarios/:id/estado", autenticar, exigirPerfil("admin"), async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) return res.status(400).json({ erro: "Não pode desativar a própria conta." });
  const alvo = await get("SELECT * FROM usuarios WHERE id=?", req.params.id);
  if (!alvo) return res.status(404).json({ erro: "Utilizador não encontrado." });
  await run("UPDATE usuarios SET ativo=?, atualizadoEm=? WHERE id=?", req.body.ativo ? 1 : 0, agora(), req.params.id);
  if (!req.body.ativo) await run("DELETE FROM sessoes WHERE usuarioId=?", req.params.id);
  await auditar(req, req.body.ativo ? "reativar" : "desativar", "utilizador", alvo.uuid, "", alvo.login);
  res.json({ ok: true });
});
app.get("/api/logins", autenticar, exigirPerfil("admin"), async (req, res) =>
  res.json(await all("SELECT * FROM logins ORDER BY id DESC LIMIT 300")));
app.get("/api/auditoria", autenticar, exigirPerfil("admin"), async (req, res) =>
  res.json(await all("SELECT * FROM auditoria ORDER BY id DESC LIMIT 300")));

/* ---------------- Código interno sequencial ---------------- */
async function proximoCodigo() {
  const ano = new Date().getFullYear();
  const r = await get("SELECT codigo FROM materiais WHERE codigo LIKE ? ORDER BY codigo DESC LIMIT 1", `TON-${ano}-%`);
  const n = r ? parseInt(r.codigo.split("-")[2], 10) + 1 : 1;
  return `TON-${ano}-${String(n).padStart(4, "0")}`;
}

/* ---------------- Sincronização offline-first ---------------- */
const COLS = {
  materiais: ["uuid","codigo","codBarra","nome","descricao","area","categoria","qtd","unidade","estado","local","dataEntrada","origem","responsavel","valor","serie","marca","foto","obs","criadoPor","criadoEm","atualizadoEm","apagado"],
  descartes: ["uuid","materialUuid","codigo","nome","area","qtd","estadoMaterial","motivo","parecerArea","parecerQSSA","fotosExtra","estadoPedido","dataSolicitacao","solicitante","atualizadoEm","apagado"],
  notificacoes: ["uuid","paraPerfis","texto","ligacao","lidaPor","data","atualizadoEm"],
  lances: ["uuid","materialUuid","codigo","nomeMaterial","tipoPedido","valor","justificacao","licitanteNome","licitanteArea","licitanteFuncao","licitanteLogin","data","atualizadoEm","apagado"],
  leiloes: ["uuid","materialUuid","codigo","nomeMaterial","area","estado","tipoDecisao","lanceVencedorUuid","vencedorNome","vencedorArea","vencedorFuncao","valorFinal","obs","decididoPor","decididoEm","atualizadoEm","apagado"]
};
async function aplicarRegisto(tabela, reg, codigosAtribuidos) {
  if (tabela === "materiais" && await get("SELECT 1 FROM eliminados WHERE uuid=?", reg.uuid)) return;
  const existente = await get(`SELECT * FROM ${tabela} WHERE uuid=?`, reg.uuid);
  if (existente && (existente.atualizadoEm || "") >= (reg.atualizadoEm || "")) return;
  if (tabela === "materiais" && (!reg.codigo || reg.codigo.startsWith("PROV"))) {
    reg.codigo = existente && existente.codigo && !existente.codigo.startsWith("PROV") ? existente.codigo : await proximoCodigo();
    codigosAtribuidos.push({ uuid: reg.uuid, codigo: reg.codigo });
  }
  const cols = COLS[tabela];
  const sql = `INSERT INTO ${tabela}(${cols.join(",")},servidorEm) VALUES(${cols.map(() => "?").join(",")},?)
    ON CONFLICT(uuid) DO UPDATE SET ${cols.filter(c => c !== "uuid").map(c => c + "=excluded." + c).join(",")},servidorEm=excluded.servidorEm`;
  await run(sql, ...cols.map(c => reg[c] ?? null), agora());
}

async function autorizarRegisto(usuario, tabela, reg) {
  const existente = await get(`SELECT * FROM ${tabela} WHERE uuid=?`, reg.uuid || "");
  if (tabela === "materiais") {
    if (!["admin", "tecnico", "responsavel"].includes(usuario.perfil)) return { ok: false, motivo: "Sem permissão para alterar materiais." };
    if (Number(reg.apagado) === 1 && usuario.perfil !== "admin") return { ok: false, motivo: "Apenas o administrador pode eliminar materiais." };
    if (!podeNaArea(usuario, reg.area) || (existente && !podeNaArea(usuario, existente.area))) return { ok: false, motivo: "Material fora das áreas atribuídas." };
    return { ok: true, existente };
  }
  if (tabela === "descartes") {
    if (!existente) {
      if (!["admin", "tecnico", "responsavel"].includes(usuario.perfil)) return { ok: false, motivo: "Sem permissão para criar pedidos de descarte." };
      if (!podeNaArea(usuario, reg.area)) return { ok: false, motivo: "Pedido fora das áreas atribuídas." };
      if (!["admin", "responsavel"].includes(usuario.perfil)) reg.parecerArea = "";
      reg.parecerQSSA = "";
      reg.estadoPedido = "Pendente";
      return { ok: true, existente };
    }
    if (usuario.perfil === "admin") return { ok: true, existente };
    if (usuario.perfil === "responsavel" && podeNaArea(usuario, existente.area)
        && apenasCampos(existente, reg, ["parecerArea", "estadoPedido", "atualizadoEm"])) return { ok: true, existente };
    if (usuario.perfil === "qssa" && apenasCampos(existente, reg, ["parecerQSSA", "atualizadoEm"])) return { ok: true, existente };
    return { ok: false, motivo: "O perfil não pode alterar estes campos do descarte." };
  }
  if (tabela === "notificacoes") {
    if (existente && apenasCampos(existente, reg, ["lidaPor", "atualizadoEm"])) return { ok: true, existente };
    const perfisFluxo = reg.ligacao === "v-leilao"
      ? ["admin", "tecnico", "responsavel", "supervisor"]
      : ["admin", "tecnico", "responsavel", "qssa"];
    return perfisFluxo.includes(usuario.perfil)
      ? { ok: true, existente }
      : { ok: false, motivo: "Sem permissão para criar esta notificação." };
  }
  if (tabela === "lances") {
    if (!["admin", "tecnico", "responsavel"].includes(usuario.perfil)) return { ok: false, motivo: "O perfil não pode licitar." };
    if (existente && existente.licitanteLogin !== usuario.login) return { ok: false, motivo: "O lance pertence a outro utilizador." };
    reg.licitanteLogin = usuario.login;
    reg.licitanteNome = usuario.nome;
    return { ok: true, existente };
  }
  if (tabela === "leiloes") {
    if (usuario.perfil !== "supervisor") return { ok: false, motivo: "Apenas o Supervisor pode decidir leilões." };
    reg.decididoPor = usuario.nome;
    return { ok: true, existente };
  }
  return { ok: false, motivo: "Tipo de alteração não autorizado." };
}

app.post("/api/sync", autenticar, async (req, res) => {
  const { desde = "", alteracoes = {} } = req.body || {};
  const codigosAtribuidos = [];
  const rejeitados = [];
  try {
    for (const t of ["materiais", "descartes", "notificacoes", "lances", "leiloes"])
      for (const reg of alteracoes[t] || []) {
        const a = await autorizarRegisto(req.usuario, t, reg);
        if (!a.ok) { rejeitados.push({ tabela: t, uuid: reg.uuid || "", motivo: a.motivo }); continue; }
        await aplicarRegisto(t, reg, codigosAtribuidos);
        await auditar(req, a.existente ? "alterar" : "criar", t, reg.uuid, reg.area || "", "Sincronização");
      }
    for (const mv of alteracoes.movimentos || []) {
      const tipo = String(mv.tipo || "");
      const mat = mv.materialUuid ? await get("SELECT area FROM materiais WHERE uuid=?", mv.materialUuid) : null;
      const autorizado = tipo.startsWith("Leilão")
        ? ["admin", "tecnico", "responsavel", "supervisor"].includes(req.usuario.perfil)
        : tipo.startsWith("Parecer")
          ? ["admin", "responsavel", "qssa"].includes(req.usuario.perfil)
          : ["admin", "tecnico", "responsavel"].includes(req.usuario.perfil);
      if (!autorizado || (mat && !podeNaArea(req.usuario, mat.area))) {
        rejeitados.push({ tabela: "movimentos", uuid: mv.uuid || "", motivo: "Movimento de histórico não autorizado." });
        continue;
      }
      try {
        await run(`INSERT INTO movimentos(uuid,materialUuid,codigo,nomeMaterial,tipo,detalhe,usuario,data,servidorEm)
          VALUES(?,?,?,?,?,?,?,?,?)`,
          mv.uuid || uuid(), mv.materialUuid, mv.codigo, mv.nomeMaterial, mv.tipo, mv.detalhe, req.usuario.nome, mv.data || agora(), agora());
        await auditar(req, "registar", "movimentos", mv.uuid, mat ? mat.area : "", tipo);
      } catch (e) { /* duplicado: ignorar */ }
    }
    const podeMover = ["admin", "tecnico", "responsavel"].includes(req.usuario.perfil);
    for (const mv of alteracoes.movstock || []) {
      if (!podeMover) { rejeitados.push({ tabela: "movstock", uuid: mv.uuid || "", motivo: "Sem permissão para movimentar stock." }); continue; }
      if (!mv || !mv.uuid || !mv.materialUuid) continue;
      if (await get("SELECT 1 FROM movstock WHERE uuid=?", mv.uuid)) continue;
      const mat = await get("SELECT * FROM materiais WHERE uuid=?", mv.materialUuid);
      if (!mat) continue;
      if (!podeNaArea(req.usuario, mat.area) || (mv.destinoArea && !podeNaArea(req.usuario, mv.destinoArea))) {
        rejeitados.push({ tabela: "movstock", uuid: mv.uuid, motivo: "Movimento fora das áreas atribuídas." }); continue;
      }
      let tipo = String(mv.tipo || "");
      let quantidadeInformada = Number(mv.qtd);
      if (!["Entrada", "Saída", "Devolução", "Ajuste", "Transferência"].includes(tipo)
          || !Number.isFinite(quantidadeInformada) || quantidadeInformada < 0
          || (tipo === "Transferência" && mv.destinoArea && !AREAS_VALIDAS.has(mv.destinoArea))) {
        rejeitados.push({ tabela: "movstock", uuid: mv.uuid, motivo: "Tipo, quantidade ou área de destino inválida." }); continue;
      }
      if (mv.estornoDe) {
        if (!["admin", "responsavel"].includes(req.usuario.perfil)) {
          rejeitados.push({ tabela: "movstock", uuid: mv.uuid, motivo: "Sem permissão para estornar movimentos." }); continue;
        }
        const orig = await get("SELECT * FROM movstock WHERE uuid=?", mv.estornoDe);
        const jaEstornado = await get("SELECT 1 FROM movstock WHERE estornoDe=?", mv.estornoDe);
        if (!orig || orig.materialUuid !== mv.materialUuid || orig.tipo === "Transferência" || orig.estornoDe || jaEstornado) {
          rejeitados.push({ tabela: "movstock", uuid: mv.uuid, motivo: "Estorno inválido ou duplicado." }); continue;
        }
        if (orig.tipo === "Entrada" || orig.tipo === "Devolução") { tipo = "Saída"; quantidadeInformada = Number(orig.qtd) || 0; }
        else if (orig.tipo === "Saída") { tipo = "Entrada"; quantidadeInformada = Number(orig.qtd) || 0; }
        else { tipo = "Ajuste"; quantidadeInformada = Number(orig.qtdAntes) || 0; }
      }
      const antes = Number(mat.qtd) || 0;
      const q = quantidadeInformada;
      if (tipo === "Saída" && q > antes) {
        rejeitados.push({ tabela: "movstock", uuid: mv.uuid, motivo: "A saída excede o saldo disponível." }); continue;
      }
      let depois = antes, novoLocal = mat.local, novaArea = mat.area, novoResp = mat.responsavel;
      if (tipo === "Entrada" || tipo === "Devolução") depois = antes + q;
      else if (tipo === "Saída") depois = antes - q;
      else if (tipo === "Ajuste") depois = q;
      else if (tipo === "Transferência") {
        depois = antes;
        if (mv.destinoLocal != null && mv.destinoLocal !== "") novoLocal = mv.destinoLocal;
        if (mv.destinoArea) novaArea = mv.destinoArea;
        if (mv.destinoResp != null && mv.destinoResp !== "") novoResp = mv.destinoResp;
      }
      const ts = agora();
      const qReg = (tipo === "Ajuste") ? depois : (tipo === "Transferência" ? antes : q);
      await run(`INSERT INTO movstock(uuid,materialUuid,codigo,nome,tipo,qtd,unidade,area,responsavel,motivo,foto,documento,qtdAntes,qtdDepois,usuario,data,atualizadoEm,servidorEm,apagado,estornoDe)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        mv.uuid, mv.materialUuid, mat.codigo, mat.nome, tipo, qReg, (mat.unidade || mv.unidade || "un"),
        novaArea, novoResp || "", mv.motivo || "", mv.foto || null, mv.documento || "",
        antes, depois, req.usuario.nome, (mv.data || ts), ts, ts, 0, mv.estornoDe || null);
      await run("UPDATE materiais SET qtd=?, local=?, area=?, responsavel=?, atualizadoEm=?, servidorEm=? WHERE uuid=?",
        depois, novoLocal, novaArea, novoResp, ts, ts, mv.materialUuid);
      try {
        const det = tipo === "Transferência"
          ? `Transferência — ${mat.local || "—"} → ${novoLocal || "—"}${novaArea !== mat.area ? (" · área " + mat.area + " → " + novaArea) : ""}${mv.documento ? (" (doc: " + mv.documento + ")") : ""}`
          : `${tipo} ${tipo === "Ajuste" ? ("→ " + depois) : (q + " " + (mat.unidade || ""))} · saldo ${antes} → ${depois}${mv.documento ? (" (doc: " + mv.documento + ")") : ""}${mv.motivo ? (" · " + mv.motivo) : ""}`;
        await run(`INSERT INTO movimentos(uuid,materialUuid,codigo,nomeMaterial,tipo,detalhe,usuario,data,servidorEm) VALUES(?,?,?,?,?,?,?,?,?)`,
          uuid(), mv.materialUuid, mat.codigo, mat.nome, "Stock: " + tipo, det, req.usuario.nome, ts, ts);
      } catch (e) {}
      await auditar(req, mv.estornoDe ? "estornar" : "registar", "movstock", mv.uuid, mat.area, tipo);
    }
    const carimbo = agora();
    const dados = {};
    for (const t of ["materiais", "descartes", "movimentos", "notificacoes", "eliminados", "lances", "leiloes", "movstock"])
      dados[t] = await all(`SELECT * FROM ${t} WHERE servidorEm > ? AND servidorEm <= ?`, desde, carimbo);
    res.json({ agora: carimbo, usuario: publicoUser(req.usuario), codigosAtribuidos, rejeitados, dados });
  } catch (e) {
    res.status(500).json({ erro: "Falha na sincronização: " + e.message });
  }
});

/* ---------------- Eliminação permanente de material (só admin) ---------------- */
app.delete("/api/materiais/:uuid", autenticar, exigirPerfil("admin"), async (req, res) => {
  const u = req.params.uuid;
  const m = await get("SELECT * FROM materiais WHERE uuid=?", u);
  try {
    await run(`INSERT INTO movimentos(uuid,materialUuid,codigo,nomeMaterial,tipo,detalhe,usuario,data,servidorEm)
      VALUES(?,?,?,?,?,?,?,?,?)`, uuid(), u, m ? m.codigo : null, m ? m.nome : "(registo)",
      "Eliminação permanente", "Registo eliminado definitivamente pelo administrador.", req.usuario.nome, agora(), agora());
    await run(`INSERT INTO eliminados(uuid,codigo,nome,por,data,servidorEm) VALUES(?,?,?,?,?,?)
      ON CONFLICT(uuid) DO UPDATE SET servidorEm=excluded.servidorEm`,
      u, m ? m.codigo : null, m ? m.nome : null, req.usuario.nome, agora(), agora());
    await run("DELETE FROM materiais WHERE uuid=?", u);
    for (const d of await all("SELECT uuid FROM descartes WHERE materialUuid=?", u))
      await run("UPDATE descartes SET apagado=1, atualizadoEm=?, servidorEm=? WHERE uuid=?", agora(), agora(), d.uuid);
    for (const l of await all("SELECT uuid FROM lances WHERE materialUuid=?", u))
      await run("UPDATE lances SET apagado=1, atualizadoEm=?, servidorEm=? WHERE uuid=?", agora(), agora(), l.uuid);
    for (const le of await all("SELECT uuid FROM leiloes WHERE materialUuid=?", u))
      await run("UPDATE leiloes SET apagado=1, atualizadoEm=?, servidorEm=? WHERE uuid=?", agora(), agora(), le.uuid);
    for (const ms of await all("SELECT uuid FROM movstock WHERE materialUuid=?", u))
      await run("UPDATE movstock SET apagado=1, atualizadoEm=?, servidorEm=? WHERE uuid=?", agora(), agora(), ms.uuid);
    await auditar(req, "eliminar_permanente", "materiais", u, m ? m.area : "", m ? `${m.codigo || ""} ${m.nome || ""}`.trim() : "");
    res.json({ ok: true, codigo: m ? m.codigo : null, nome: m ? m.nome : null });
  } catch (e) {
    res.status(500).json({ erro: "Falha ao eliminar: " + e.message });
  }
});

/* ---------------- Dados de teste (admin) ---------------- */
app.post("/api/seed", autenticar, exigirPerfil("admin"), async (req, res) => {
  const exemplos = [
    { nome: "Bomba centrífuga de reserva", area: "Manutenção", categoria: "Equipamento mecânico", qtd: 1, unidade: "un", estado: "Bom", local: "Zona A, Estrado 2", dataEntrada: "2024-03-15", origem: "Compra local", responsavel: "Jorge Agostinho", marca: "KSB Etanorm", valor: 850000 },
    { nome: "Capacetes de segurança brancos", area: "QSSA", categoria: "EPI", qtd: 25, unidade: "un", estado: "Novo", local: "Corredor B, Prateleira 1", dataEntrada: "2026-01-10", origem: "Fornecedor Luanda", responsavel: "Roni", valor: 125000 },
    { nome: "Computador desktop antigo", area: "Informática", categoria: "Equipamento informático", qtd: 3, unidade: "un", estado: "Obsoleto", local: "Sala de arrumos, Caixa 7", dataEntrada: "2019-06-01", origem: "Transferência sede", responsavel: "Gilberto Francisco", serie: "DT-2019-0042", marca: "HP ProDesk 400 G4" },
    { nome: "Reagentes de densidade (kit)", area: "Laboratório", categoria: "Reagente", qtd: 2, unidade: "cx", estado: "Usado", local: "Armário L1", dataEntrada: "2025-08-20", origem: "Compra importação", responsavel: "Helder Gomes" },
    { nome: "Mangueira de descarga 4 pol.", area: "Movimentação de Produtos", categoria: "Mangueira", qtd: 4, unidade: "rolo", estado: "Avariado", local: "Zona C, Chão", origem: "Stock antigo", responsavel: "Augusto Nicolau" },
    { nome: "Cadeiras de escritório", area: "Administração", categoria: "Mobiliário", qtd: 6, unidade: "un", estado: "Sem uso / avaliar reaproveitamento", local: "Sala de arrumos", dataEntrada: "2022-02-11", origem: "Renovação escritórios" },
    { nome: "Rádios portáteis VHF", area: "SISE", categoria: "Comunicações", qtd: 5, unidade: "un", estado: "Bom", local: "Corredor B, Prateleira 4", dataEntrada: "2025-11-02", origem: "Compra local", responsavel: "Augusto Nicolau", marca: "Motorola DP1400", valor: 480000 },
    { nome: "Extintores PQS 6 kg (recarga vencida)", area: "QSSA", categoria: "Combate a incêndio", qtd: 8, unidade: "un", estado: "Para descarte", local: "Zona D, Estrado 1", dataEntrada: "2020-05-30", origem: "Stock antigo", responsavel: "Roni" }
  ];
  const cods = [];
  for (const ex of exemplos) {
    ex.uuid = uuid(); ex.criadoPor = req.usuario.nome; ex.criadoEm = agora(); ex.atualizadoEm = agora();
    await aplicarRegisto("materiais", ex, cods);
    await run(`INSERT INTO movimentos(uuid,materialUuid,codigo,nomeMaterial,tipo,detalhe,usuario,data,servidorEm)
      VALUES(?,?,?,?,?,?,?,?,?)`,
      uuid(), ex.uuid, ex.codigo, ex.nome, "Entrada / cadastro", "Material de exemplo carregado", req.usuario.nome, agora(), agora());
  }
  await auditar(req, "carregar_dados_teste", "materiais", "", "", `${cods.length} materiais criados`);
  res.json({ ok: true, criados: cods.length });
});

app.get("/api/estado", (req, res) => res.json({ app: "Inventário TON", versao: "2.7-web", agora: agora() }));

/* ---------------- Arranque ---------------- */
function ipsLAN() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
}
(async () => {
  try {
    await criarEsquema();
    await criarContasIniciais();
  } catch (e) {
    console.error("ERRO ao preparar a base de dados:", e.message);
    process.exit(1);
  }
  app.listen(PORTA, "0.0.0.0", () => {
    console.log("==============================================");
    console.log(" Inventário TON (web) — servidor em execução");
    console.log(" Porta: " + PORTA);
    if (!process.env.PORT) {
      console.log(" Aceda no computador:  http://localhost:" + PORTA);
      ipsLAN().forEach(ip => console.log(" Na rede local:        http://" + ip + ":" + PORTA));
    }
    console.log(" Base de dados: " + (process.env.TURSO_DATABASE_URL ? "Turso (nuvem)" : "ficheiro local (teste)"));
    console.log("==============================================");
  });
})();
