# Inventário TON v2.7 — Manual de instalação e utilização

**Gestão e inventário de materiais do armazém — Terminal Oceânico do Namibe (Sonangol D&C)**

A versão 2.0 passa a funcionar em rede: um pequeno servidor central na LAN do TON guarda todos os dados, e computadores e telemóveis acedem como aplicativo instalável (PWA), com funcionamento offline e sincronização automática.

---

## 1. O que mudou em relação à v1.0

| Funcionalidade | v1.0 | v2.0 |
|---|---|---|
| Dados | Só no dispositivo | **Base central no servidor da LAN** (todos veem o mesmo inventário) |
| Offline | Total, mas isolado | **Offline-first**: trabalha sem rede; as alterações ficam em fila e seguem quando há ligação |
| Instalação | Ficheiro HTML | **App instalável** com ícone e ecrã de arranque (PWA) |
| QR Code | — | **Leitura pela câmara** ("apontar e abrir ficha") + **etiquetas QR imprimíveis** |
| Exportação | CSV | **Excel .xlsx formatado** (cabeçalho Sonangol, zebra, bordas) + **PDF com logótipo** |
| Descarte | Básico | **Pareceres formais** (área + QSSA editável), até 4 fotos de evidência, **notificações internas** |
| Carga inicial | Manual | **Importação em massa via Excel** com modelo e validação |
| Segurança | Hash simples | **bcrypt**, sessões com expiração, **registo de acessos imutável**, histórico de movimentações **bloqueado contra eliminação** ao nível da base de dados |

---

## 2. Instalação do servidor (uma vez, no computador-servidor do TON)

Pode ser o mesmo computador que já serve o app QSSA.

1. **Instalar o Node.js LTS** (versão 22 ou superior) a partir de <https://nodejs.org> — instalação "seguinte, seguinte".
2. Copiar a pasta **`inventario-ton-v2`** para o computador (ex.: `C:\Apps\inventario-ton-v2`).
3. Fazer duplo clique em **`INICIAR_SERVIDOR.bat`**. Na primeira execução instala as dependências (precisa de internet só nessa primeira vez); depois funciona totalmente offline na LAN.
4. A janela mostra os endereços de acesso, por exemplo:

```
 Aceda no computador:  http://localhost:3000
 Na rede do TON:       http://192.168.1.50:3000
```

5. **Anote o endereço da rede** — é esse que os telemóveis e outros computadores vão usar.

> **Manter o servidor ligado:** a janela do `INICIAR_SERVIDOR.bat` deve ficar aberta. Para arranque automático com o Windows, coloque um atalho do .bat na pasta Arranque (`Win+R` → `shell:startup`).

**Utilizador inicial:** a conta `admin` é criada com uma senha temporária definida pela variável `INITIAL_ADMIN_PASSWORD` ou, na ausência desta, com uma senha aleatória mostrada uma única vez no registo de arranque. A troca da senha é obrigatória no primeiro acesso. Não existem senhas padrão no código.

---

## 3. Instalação nos dispositivos (cada telemóvel/computador)

1. Abrir o Chrome (ou Edge) e ir ao endereço do servidor, ex.: `http://192.168.1.50:3000`.
2. Entrar com o utilizador criado pelo administrador.
3. Instalar como app:
   - **Android (Chrome):** menu ⋮ → **Adicionar ao ecrã principal** / **Instalar aplicação**.
   - **Windows (Chrome/Edge):** ícone de instalação na barra de endereço → **Instalar**.

O app fica com ícone próprio, abre em janela própria e funciona offline.

### 3.1 Ativar câmara e modo offline no acesso por rede (passo importante, uma vez por dispositivo)

Por política dos navegadores, a **câmara (leitura QR)** e o **modo offline (service worker)** só funcionam em endereços "seguros". No próprio servidor (`localhost`) funciona tudo sem ajustes; nos restantes dispositivos escolha **uma** destas opções:

**Opção A — recomendada (Chrome, uma vez por dispositivo):**
1. Abrir `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. No campo, escrever o endereço do servidor: `http://192.168.1.50:3000`
3. Mudar para **Enabled** e reiniciar o Chrome.

**Opção B — HTTPS:** aceder por `https://192.168.1.50:3443` (o servidor já inclui certificado próprio). O navegador mostra um aviso de "ligação não privada" na primeira vez — escolher **Avançadas → Continuar**. Normal em redes internas com certificado autoassinado.

Sem este passo, o app funciona na mesma para consultar e registar (com o servidor acessível) — apenas a leitura QR e o uso sem rede ficam limitados nesse dispositivo.

---

## 4. Como o sistema funciona em rede

- Tudo o que se grava vai primeiro para o **dispositivo** e para uma **fila de envio**; em segundos é enviado ao servidor e distribuído aos restantes.
- O indicador no canto superior direito mostra o estado: **Sincronizado**, ou **Offline · N pendentes**.
- **Sem rede:** continue a trabalhar normalmente — cadastros, descartes, fotos. Ao voltar a rede, tudo segue sozinho (também pode tocar em "Sincronizar agora" no Painel geral).
- **Códigos internos** (TON-2026-0001…) são atribuídos **pelo servidor** na sincronização, garantindo sequência única mesmo com vários dispositivos. Um material criado offline mostra "a sincronizar" até receber o código.
- **Conflitos:** se dois utilizadores editarem o mesmo material, vale a alteração mais recente.

---

## 5. Guia rápido por módulo

**Painel geral** — totais, materiais por área, últimos cadastros, pendentes de sincronização.

**Materiais** — pesquisa e filtros (área, estado, localização); **Ver / Editar / Descarte / 🏷️ etiqueta**; botão **📷 Ler QR** no topo abre a câmara: ao apontar para uma etiqueta, abre a ficha do material. **Eliminar permanentemente (🗑️):** botão visível **apenas para o administrador** (na lista e na ficha) — **remove definitivamente** o registo, **sem passar pelo pedido de descarte**, com confirmação. A remoção propaga-se a todos os dispositivos e o registo **não é recuperável nem reaparece** numa sincronização posterior; o **histórico de movimentações guarda** a eliminação (auditoria). Requer **ligação ao servidor** (não funciona offline). Os perfis Técnico, Responsável e Consulta **não** dispõem desta opção, e a regra é imposta também no servidor.

**Etiquetas QR** — botão "🏷️ Etiquetas QR" imprime etiquetas (62 mm) de todos os materiais filtrados; o 🏷️ em cada linha imprime uma só. Cole-as nas prateleiras/equipamentos.

**Cadastro** — todos os campos do levantamento + fotografia pela câmara + **assistente de classificação** (7 perguntas que sugerem o estado conforme as regras definidas).

**Descarte** — pedido com motivo, parecer da área, **até 4 fotos de evidência** e confirmações obrigatórias (nº de série/autorização para Informática; avaliação de risco para QSSA/Laboratório). O Responsável de área emite o parecer da sua área e altera o estado do pedido; o perfil QSSA edita exclusivamente o parecer QSSA; o Administrador pode intervir em todo o fluxo. Cada novo pedido e cada decisão geram **notificações internas**.

**Relatórios** — os 9 relatórios com **Excel .xlsx** formatado (cabeçalho institucional Sonangol, azul #0E2A47) e **PDF com logótipo** e rodapé paginado. Para usar o logótipo oficial, basta substituir o ficheiro `public/img/logo.png` no servidor.

**Configurações** — Administrador e Técnico podem fazer a **importação em massa via Excel** e importar a lista de avaliação. Todos os utilizadores podem alterar a própria senha. A cópia de segurança é reservada ao Administrador. O carregamento de dados de teste foi removido do ambiente de produção.

> **Preço de avaliação:** cada material tem o campo **Preço de avaliação (Kz)**, visível na lista de Materiais (coluna "Preço aval.") e na ficha (com o **Valor total = quantidade × preço**). Os relatórios em Excel/PDF incluem as colunas "Preço aval. (Kz)" e "Valor total (Kz)".

> **Área automática na importação da avaliação:** os itens recebem a área pela categoria — *Informatica → Informática*, *EPI/EPC/Combate/Instrumentos/Placas/Sinalização/Médico → QSSA*, *Equipamento/Eléctrico/Metálico/Cabos/Baterias → Manutenção*, *Material de Escritório → Administração*; as restantes ficam com a "área por omissão" escolhida. Pode editar a área de qualquer item depois.

> **Imagens dos itens (link clicável):** ao importar a lista de avaliação, a imagem de cada item fica ligada ao seu nome. Na lista de **Materiais**, o nome aparece como link **🖼️** — clicar mostra a imagem; na ficha, a miniatura amplia ao clicar. As imagens são servidas pelo servidor a partir de uma pasta:
> - Por omissão, o servidor usa a pasta **`imagens`** dentro da app. Copie para lá os ficheiros do levantamento (mantendo exatamente os nomes), **ou**
> - defina a variável **`IMAGENS_DIR`** para a pasta onde estão as imagens (ex.: a pasta original do levantamento). O `INICIAR_SERVIDOR.bat` já aponta automaticamente para `C:\Users\Jorge\Pictures\Inventario TON 2026` quando essa pasta existe.
> - Nota: ficheiros **`.HEIC`** não são apresentados pelos navegadores — converta-os para `.jpg` se quiser vê-los na app.

**Utilizadores** (só admin) — criar, ativar e desativar contas; alterar perfil e áreas; redefinir senha temporária; e consultar os registos imutáveis de **acessos** e **ações administrativas/operacionais**. Perfis disponíveis: Administrador, Técnico de inventário, Responsável de área, QSSA, Supervisor e Consulta (somente leitura).

---

## 6. Cópia de segurança

Todos os dados estão num único ficheiro no servidor: **`inventario_ton.db`** (na pasta do aplicativo). Copie-o regularmente (semanal, por exemplo) para pen/OneDrive/pasta de rede. Para repor, basta substituir o ficheiro com o servidor parado.

---

## 7. Resolução de problemas

| Problema | Solução |
|---|---|
| "Offline" permanente nos telemóveis | Verificar se a janela do servidor está aberta e se o dispositivo está no Wi-Fi do TON; confirmar o endereço IP (pode mudar — convém fixar IP estático no servidor) |
| Câmara não abre | Aplicar o passo 3.1 (opção A ou B) nesse dispositivo |
| Porta 3000 ocupada | Iniciar com outra porta: `set PORTA=3001 && node server.js` |
| Esqueci a senha | Pedir a um Administrador para usar **Redefinir senha**. A conta receberá uma senha temporária e deverá alterá-la no primeiro acesso |
| Node.js não encontrado | Instalar o Node.js LTS e voltar a correr o .bat |

---

---

## 8. Leilão de materiais avariados/obsoletos

O módulo **Leilão de materiais** permite aos perfis Administrador, Técnico, Responsável e **Participante do leilão** solicitar ao Supervisor o **abate** (compra, com valor) ou a **atribuição** (oferta sem custo) dos materiais avariados ou obsoletos do armazém.

**Materiais elegíveis:** aparecem automaticamente os materiais nos estados *Avariado*, *Obsoleto*, *Para descarte* e *Sem uso / avaliar reaproveitamento*.

**Participar:**
1. No módulo **Leilão de materiais**, faça o **registo de participante** (nome completo, área e função) — fica guardado no dispositivo.
2. Em cada material, toque em **Fazer lance** e escolha o tipo: **Abate** (indica um valor em Kz) ou **Atribuição** (indica a justificação, sem custo).
3. O **cronómetro de 42 horas** de cada material começa no **primeiro lance** e conta em contagem decrescente. Enquanto o tempo corre, qualquer participante pode cobrir o valor.
4. Terminado o tempo, fica destacado o **lance mais alto** (vencedor provável), a aguardar a decisão do Supervisor.

> **Consulta/Convidado:** é um perfil estritamente de leitura, inclusive no leilão. Cada participante que faça lances deve usar a sua própria conta, garantindo autoria e rastreabilidade.

> **Participante do leilão:** tem acesso apenas ao módulo de leilão e à alteração da própria senha. Pode consultar materiais elegíveis, registar os seus dados e apresentar lances. Não pode alterar materiais, stock, descartes, importações, utilizadores ou decisões. A identidade dos restantes participantes é ocultada pelo servidor.

**Supervisor:** qualquer conta ativa com perfil **Supervisor (leilão)** vê todos os lances e pode **aprovar** ou **recusar** o pedido. A identidade do Supervisor que decidiu é registada automaticamente pelo servidor.

> **Conta inicial do Supervisor:** numa instalação nova, é criada com a senha temporária definida em `INITIAL_SUPERVISOR_PASSWORD` ou, na ausência desta, com uma senha aleatória mostrada uma única vez no registo de arranque. A troca é obrigatória no primeiro acesso.

**Proposta automática:** cada pedido aprovado gera automaticamente um **texto de proposta** associado ao Supervisor que tomou a decisão, com os dados do participante e os materiais/valores propostos. O texto pode ser copiado ou enviado, e cada participante vê as suas propostas aprovadas; os Supervisores veem todas.

> **Nota técnica:** os lances e as decisões sincronizam entre todos os dispositivos, tal como o restante inventário (offline-first). A cópia direta de imagens e a partilha (Web Share) requerem um acesso "seguro" (localhost, HTTPS, ou a exceção do `chrome://flags` descrita no ponto 3.1); nos restantes casos a imagem abre para guardar/anexar manualmente. O envio por WhatsApp/e-mail e a cópia de texto funcionam sempre.

---

## 9. Movimentos de stock e ficha de armazém (kardex) (v2.5)

Novo módulo **Movimentos de stock** no menu. A quantidade de cada material deixa de ser editada à mão e passa a ser o resultado dos movimentos registados, com recálculo automático do saldo.

**Tipos de movimento:** Entrada (receção), Saída (requisição/consumo), Devolução, Ajuste (após contagem — indica-se o novo saldo contado) e Transferência (muda localização, área ou responsável, sem alterar a quantidade). Cada movimento guarda data, utilizador, documento/referência, motivo e, opcionalmente, uma foto, e regista o saldo antes e depois.

**Registar:** use **+ Registar movimento** no módulo, ou os botões **+ Entrada** / **− Saída** na lista de Materiais e na ficha de cada material. Uma saída não pode exceder o saldo; para corrigir um saldo errado, use **Ajuste**.

**Ficha de armazém (kardex):** o botão **Ficha** (na lista de Materiais, na ficha do material e no módulo de stock) mostra o histórico do material com o saldo corrente, e permite **Imprimir / PDF**.

**Correções:** os administradores e responsáveis de área podem **estornar** um movimento — é criado um movimento de correção que repõe o saldo, mantendo o histórico (nada é apagado).

**Saldo autoritativo no servidor:** o efeito de cada movimento é aplicado uma única vez, sobre o saldo atual guardado no servidor. Assim, mesmo que dois dispositivos registem movimentos offline ao mesmo tempo, ambos são contabilizados quando sincronizam — não há perda de contagem. Na edição de um material, o campo Quantidade fica bloqueado (a quantidade é gerida pelos movimentos); no cadastro de um material novo, a quantidade indicada é o saldo de abertura.

**Permissões:** registam movimentos os perfis Administrador, Técnico de inventário e Responsável de área; o estorno é reservado a Administrador e Responsável de área; os perfis Consulta e Supervisor podem consultar os movimentos e as fichas.

---

## 10. Listas paginadas e navegação (v2.6)

As listas extensas passam a ser **paginadas**, para não ser preciso percorrer ecrãs muito longos. Aplica-se a Materiais, Movimentos de stock, Descartes, Relatórios (no ecrã), Leilão e Registo de acessos.

Em cada lista há uma barra de paginação, no topo e no fundo, com a contagem (por exemplo, «1–50 de 283»), os botões de página e a opção **Por página** (25, 50, 100 ou 200), que fica memorizada no dispositivo. Ao mudar de página, o ecrã volta ao topo, e existe um botão flutuante **↑** para voltar ao topo rapidamente. Os filtros continuam a funcionar sobre a lista completa; a exportação de relatórios em Excel/PDF inclui sempre todos os registos, não apenas a página visível.

## 11. Perfis, áreas e auditoria (v2.7)

| Perfil | Utilização recomendada | Permissões principais |
|---|---|---|
| Administrador | Gestão do sistema | Acesso total, eliminação permanente, utilizadores, backup e auditoria |
| Técnico | Equipa de inventário | Cadastro/edição, importação, movimentos, pedidos de descarte e lances; sem aprovar descartes nem estornar |
| Responsável | Responsável operacional | Edita, movimenta, estorna e emite parecer apenas nas áreas atribuídas; participa no leilão |
| QSSA | Avaliação de segurança | Consulta o inventário e edita exclusivamente o parecer QSSA nos descartes |
| Supervisor | Decisão do leilão | Consulta o inventário e aprova/recusa propostas; não altera stock ou materiais |
| Participante | Participação individual no leilão | Consulta materiais elegíveis, regista-se e apresenta lances; sem acesso operacional ao inventário |
| Consulta | Auditoria/consulta | Somente leitura e exportação; não faz lances nem altera dados |

As permissões são verificadas no servidor, inclusive durante sincronizações offline. Alterações não autorizadas são rejeitadas e identificadas ao utilizador. Sessões duram até 12 horas; alterações de perfil, áreas, estado da conta ou redefinição de senha encerram as sessões afetadas. Responsáveis existentes sem área definida recebem temporariamente **Todas — atribuir área** para não interromper a operação; o Administrador deve substituir essa marcação pelas áreas reais em **Utilizadores**.

*Inventário TON v2.7 · Sonangol Distribuição e Comercialização — Terminal Oceânico do Namibe · 2026*
