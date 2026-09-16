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

/* ---------------- Esquema ---------------- */
async function criarEsquema() {
  await exec(`
CREATE TABLE IF NOT EXISTS usuarios(
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, nome TEXT, login TEXT UNIQUE,
  senhaHash TEXT, perfil TEXT, ativo INTEGER DEFAULT 1, criadoEm TEXT, atualizadoEm TEXT);
CREATE TABLE IF NOT EXISTS sessoes(token TEXT PRIMARY KEY, usuarioId INTEGER, criadoEm TEXT, expiraEm TEXT);
CREATE TABLE IF NOT EXISTS logins(
  id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT, sucesso INTEGER, ip TEXT, agente TEXT, data TEXT);
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
`);
}

/* Contas iniciais */
async function criarContasIniciais() {
  if ((await get("SELECT COUNT(*) c FROM usuarios")).c === 0) {
    await run(`INSERT INTO usuarios(uuid,nome,login,senhaHash,perfil,criadoEm,atualizadoEm)
      VALUES(?,?,?,?,?,?,?)`,
      uuid(), "Administrador", "admin", bcrypt.hashSync("ton2026", 10), "admin", agora(), agora());
    console.log("Utilizador inicial criado: admin / ton2026");
  }
  if ((await get("SELECT COUNT(*) c FROM usuarios WHERE perfil='supervisor'")).c === 0
      && !(await get("SELECT 1 FROM usuarios WHERE lower(login)='augusto'"))) {
    await run(`INSERT INTO usuarios(uuid,nome,login,senhaHash,perfil,criadoEm,atualizadoEm)
      VALUES(?,?,?,?,?,?,?)`,
      uuid(), "Augusto Nicolau", "augusto", bcrypt.hashSync("ton2026", 10), "supervisor", agora(), agora());
    console.log("Conta de Supervisor criada: augusto / ton2026 (altere a senha no primeiro acesso)");
  }
}

/* ---------------- App ---------------- */
const app = express();
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* Pasta de imagens dos materiais (servida em /imagens).
   Por omissão usa a pasta "imagens" dentro do app; pode apontar-se outra
   com a variável de ambiente IMAGENS_DIR. */
const PASTA_IMAGENS = process.env.IMAGENS_DIR || path.join(__dirname, "imagens");
try { fs.mkdirSync(PASTA_IMAGENS, { recursive: true }); } catch (e) {}
app.use("/imagens", express.static(PASTA_IMAGENS, { fallthrough: true }));

const publicoUser = u => ({ id: u.id, uuid: u.uuid, nome: u.nome, login: u.login, perfil: u.perfil, ativo: u.ativo, criadoEm: u.criadoEm });

/* Autenticação por token */
async function autenticar(req, res, next) {
  try {
    const tk = (req.headers.authorization || "").replace("Bearer ", "");
    const s = tk && await get("SELECT * FROM sessoes WHERE token=?", tk);
    if (!s || s.expiraEm < agora()) return res.status(401).json({ erro: "Sessão inválida ou expirada." });
    req.usuario = await get("SELECT * FROM usuarios WHERE id=? AND ativo=1", s.usuarioId);
    if (!req.usuario) return res.status(401).json({ erro: "Utilizador inativo." });
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
    const ip = req.socket.remoteAddress, agente = (req.headers["user-agent"] || "").slice(0, 180);
    const u = await get("SELECT * FROM usuarios WHERE lower(login)=lower(?) AND ativo=1", login || "");
    const ok = !!(u && bcrypt.compareSync(senha || "", u.senhaHash));
    await run("INSERT INTO logins(login,sucesso,ip,agente,data) VALUES(?,?,?,?,?)",
      login || "?", ok ? 1 : 0, ip, agente, agora());
    if (!ok) return res.status(401).json({ erro: "Utilizador ou senha incorretos." });
    const token = crypto.randomBytes(32).toString("hex");
    const expira = new Date(Date.now() + 30 * 864e5).toISOString();
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
  if (!novaSenha || novaSenha.length < 6) return res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres." });
  await run("UPDATE usuarios SET senhaHash=?, atualizadoEm=? WHERE id=?", bcrypt.hashSync(novaSenha, 10), agora(), req.usuario.id);
  res.json({ ok: true });
});

/* ---------------- Utilizadores (admin) ---------------- */
app.get("/api/usuarios", autenticar, exigirPerfil("admin"), async (req, res) =>
  res.json((await all("SELECT * FROM usuarios")).map(publicoUser)));
app.post("/api/usuarios", autenticar, exigirPerfil("admin"), async (req, res) => {
  const { nome, login, senha, perfil } = req.body || {};
  if (!nome || !login || !senha || !perfil) return res.status(400).json({ erro: "Dados incompletos." });
  if (await get("SELECT 1 FROM usuarios WHERE lower(login)=lower(?)", login)) return res.status(400).json({ erro: "Login já existe." });
  await run("INSERT INTO usuarios(uuid,nome,login,senhaHash,perfil,criadoEm,atualizadoEm) VALUES(?,?,?,?,?,?,?)",
    uuid(), nome, login, bcrypt.hashSync(senha, 10), perfil, agora(), agora());
  res.json({ ok: true });
});
app.post("/api/usuarios/:id/estado", autenticar, exigirPerfil("admin"), async (req, res) => {
  if (Number(req.params.id) === req.usuario.id) return res.status(400).json({ erro: "Não pode desativar a própria conta." });
  await run("UPDATE usuarios SET ativo=?, atualizadoEm=? WHERE id=?", req.body.ativo ? 1 : 0, agora(), req.params.id);
  res.json({ ok: true });
});
app.get("/api/logins", autenticar, exigirPerfil("admin"), async (req, res) =>
  res.json(await all("SELECT * FROM logins ORDER BY id DESC LIMIT 300")));

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
app.post("/api/sync", autenticar, async (req, res) => {
  const { desde = "", alteracoes = {} } = req.body || {};
  const codigosAtribuidos = [];
  const soLeitura = req.usuario.perfil === "consulta";
  try {
    const ehAdmin = req.usuario.perfil === "admin";
    const ehSupervisor = req.usuario.perfil === "supervisor";
    const tabelasConvidado = new Set(["lances", "notificacoes"]);
    for (const t of ["materiais", "descartes", "notificacoes", "lances", "leiloes"])
      for (const reg of alteracoes[t] || []) {
        if (soLeitura && !tabelasConvidado.has(t)) continue;
        if (soLeitura && t === "notificacoes" && reg.ligacao !== "v-leilao") continue;
        if (t === "materiais" && Number(reg.apagado) === 1 && !ehAdmin) continue;
        if (t === "leiloes" && !ehSupervisor) continue;
        await aplicarRegisto(t, reg, codigosAtribuidos);
      }
    for (const mv of alteracoes.movimentos || []) {
      if (soLeitura && !(mv.tipo && mv.tipo.startsWith("Leilão"))) continue;
      try {
        await run(`INSERT INTO movimentos(uuid,materialUuid,codigo,nomeMaterial,tipo,detalhe,usuario,data,servidorEm)
          VALUES(?,?,?,?,?,?,?,?,?)`,
          mv.uuid || uuid(), mv.materialUuid, mv.codigo, mv.nomeMaterial, mv.tipo, mv.detalhe, mv.usuario, mv.data, agora());
      } catch (e) { /* duplicado: ignorar */ }
    }
    const podeMover = ["admin", "tecnico", "responsavel"].includes(req.usuario.perfil);
    if (podeMover) for (const mv of alteracoes.movstock || []) {
      if (!mv || !mv.uuid || !mv.materialUuid) continue;
      if (await get("SELECT 1 FROM movstock WHERE uuid=?", mv.uuid)) continue;
      const mat = await get("SELECT * FROM materiais WHERE uuid=?", mv.materialUuid);
      if (!mat) continue;
      const antes = Number(mat.qtd) || 0;
      const q = Math.abs(Number(mv.qtd) || 0);
      const tipo = mv.tipo || "Ajuste";
      let depois = antes, novoLocal = mat.local, novaArea = mat.area, novoResp = mat.responsavel;
      if (tipo === "Entrada" || tipo === "Devolução") depois = antes + q;
      else if (tipo === "Saída") depois = Math.max(0, antes - q);
      else if (tipo === "Ajuste") depois = Math.max(0, Number(mv.qtd) || 0);
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
        antes, depois, (mv.usuario || req.usuario.nome), (mv.data || ts), ts, ts, 0, mv.estornoDe || null);
      await run("UPDATE materiais SET qtd=?, local=?, area=?, responsavel=?, atualizadoEm=?, servidorEm=? WHERE uuid=?",
        depois, novoLocal, novaArea, novoResp, ts, ts, mv.materialUuid);
      try {
        const det = tipo === "Transferência"
          ? `Transferência — ${mat.local || "—"} → ${novoLocal || "—"}${novaArea !== mat.area ? (" · área " + mat.area + " → " + novaArea) : ""}${mv.documento ? (" (doc: " + mv.documento + ")") : ""}`
          : `${tipo} ${tipo === "Ajuste" ? ("→ " + depois) : (q + " " + (mat.unidade || ""))} · saldo ${antes} → ${depois}${mv.documento ? (" (doc: " + mv.documento + ")") : ""}${mv.motivo ? (" · " + mv.motivo) : ""}`;
        await run(`INSERT INTO movimentos(uuid,materialUuid,codigo,nomeMaterial,tipo,detalhe,usuario,data,servidorEm) VALUES(?,?,?,?,?,?,?,?,?)`,
          uuid(), mv.materialUuid, mat.codigo, mat.nome, "Stock: " + tipo, det, (mv.usuario || req.usuario.nome), ts, ts);
      } catch (e) {}
    }
    const carimbo = agora();
    const dados = {};
    for (const t of ["materiais", "descartes", "movimentos", "notificacoes", "eliminados", "lances", "leiloes", "movstock"])
      dados[t] = await all(`SELECT * FROM ${t} WHERE servidorEm > ? AND servidorEm <= ?`, desde, carimbo);
    res.json({ agora: carimbo, codigosAtribuidos, dados });
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
  res.json({ ok: true, criados: cods.length });
});

app.get("/api/estado", (req, res) => res.json({ app: "Inventário TON", versao: "2.6-web", agora: agora() }));

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
