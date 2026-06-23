# Roadmap — UFCIM backend

Trabalho futuro, com detalhe suficiente para retomar sem recarregar contexto.
Itens com decisão de arquitetura tomada apontam para o ADR correspondente em
`docs/adr/`; itens prontos para execução apontam para `plans/`.

Convenção de prontidão:
- **Pronto p/ executar** — existe um plano em `plans/`.
- **Sob gatilho** — especificado, mas só executar quando o gatilho disparar.
- **Ideia** — direção validada, sem plano ainda.

---

## 1. Enforcement de sobreposição de reservas — *em 3 estágios*

Decisão completa: `docs/adr/0001-reservation-overlap-enforcement.md`.

- **Estágio 1 — agora (POC/D1)** · *Pronto p/ executar* ·
  `plans/003-double-booking-guard-and-doc-fix.md`
  Índice único parcial contra duplicata exata + tradução do erro + correção da
  doc. Mata a corrida de double-submit.

- **Estágio 2 — grade horária de ocupação** · *Sob gatilho* ·
  `plans/004-occupancy-grid-overlap-enforcement.md`
  Tabela compartilhada `occupancy_slots` (presença = ocupação), `OccupancyService`
  como único escritor, mutações em `db.batch`, override = evict-then-claim.
  **Gatilho composto:** (a) 2º departamento com usuários reais criando reservas
  em D1, **ou** (b) qualquer double-booking real observado em produção.
  **Off-ramp:** se a migração Postgres for agendada antes, pular para o Estágio 3.

  - **Fase 2b — migração dos reads** · *Sob gatilho (após o Estágio 2)* · *Ideia*
    Depois que a escrita estiver na grade, migrar os reads para `occupancy_slots`
    e aposentar a matemática de intervalos:
    - `buildHourlyAvailability` (`src/lib/schedule.ts`) — alvo natural: cada linha
      de ocupação **é** um slot, então a matemática de overlap some.
    - `checkSlotAvailability` (pré-check de UX) passa a consultar `occupancy_slots`.
    - `report.service` — ocupação vira `COUNT` de linhas, mais simples.
    - Admin views.
    Mantida separada para que o Estágio 2 (corretude) seja pequeno e executável
    sob pressão; esta fase é o ganho de legibilidade, não a garantia.

- **Estágio 3 — restrição de exclusão no Postgres** · *Sob gatilho (na migração)*
  Uma linha de DDL (`EXCLUDE USING gist (... WITH &&)`) na própria tabela
  `reservations`. Torna `occupancy_slots` redundante (remover, se existir).

## 2. Visibilidade de espaços por escopo · *Ideia*

Hoje `GET /api/v1/spaces` retorna **todos** os espaços a qualquer usuário
autenticado, enquanto reservas são confinadas por departamento. O modelo
(`spaces.department`) e o padrão `assertDepartmentAccess` já existem — confinar a
listagem é uma mudança pequena na camada de serviço. Decidir: estudantes/
professores veem só o próprio departamento? Staff vê tudo? Item de roadmap do
README original (visibilidade por escopo). Vira plano de design/spike quando
selecionado.

## 3. Recuperação de senha self-service (forgot-password) · *Ideia*

A maquinaria de reset já existe (`invitations.purpose='reset'`, ramo de reset em
`acceptInvitation`, template de e-mail), mas só é alcançável pela rota de
master-admin (`src/routes/admin.ts:356`). Uma rota pública
`/auth/request-reset`, espelhando `/auth/request-invitation` (rate limit +
Turnstile), fecharia a assimetria. **Requisito de segurança:** resposta
constante ("se o e-mail existir, enviamos um link") para não vazar enumeração de
contas (ver item 4).

## 4. Endurecimento de autenticação · *Ideia*

- **Enumeração de usuários no login** (`src/services/auth.service.ts:40-54`):
  e-mails inexistentes retornam de imediato (sem pbkdf2, sem lockout), permitindo
  distinguir contas válidas por timing/comportamento. Normalizar custo/resposta.
- **Rate limit confia em `X-Forwarded-For` spoofável** como fallback
  (`src/middleware/rate-limit.ts:25-29`). Baixa exposição em Cloudflare
  (`CF-Connecting-IP` sempre presente); relevante fora da Cloudflare.
- Bundlar como um único passe de hardening de auth.

## 5. Cap de intervalo no relatório de ocupação · *Ideia*

`getSpaceReport` limita o intervalo a 90 dias (`report.service.ts:122-125`), mas
o `occupancyQuerySchema` da rota `/occupancy` não tem cap equivalente — possível
amplificação de recurso. Investigar e alinhar.

## 6. Itens do README original (longo prazo) · *Ideia*

- Integração completa com Keycloak JWT em produção.
- Expansão para outros departamentos e campi além do IAUD/Benfica (é o **gatilho
  (a)** do item 1, Estágio 2).
- Migração D1 → Postgres em servidor universitário (é o **Estágio 3** do item 1).
- Integração com monitoramento ambiental IoT (Zigbee2MQTT + Raspberry Pi).
</content>
