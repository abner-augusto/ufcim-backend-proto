# ADR 0001 — Enforcement de sobreposição de reservas

- **Status**: Aceito
- **Data**: 2026-06-23
- **Commit de referência**: `ad08a7d`
- **Decisores**: equipe UFCIM

## Contexto

`ReservationService.create` verifica disponibilidade (`checkSlotAvailability`) e
em seguida insere a reserva em dois passos `await` separados, **sem transação e
sem nenhuma restrição no banco** (`src/services/reservation.service.ts:66` lê as
reservas existentes, `:79` insere). Duas requisições concorrentes para o mesmo
horário podem ambas passar pela verificação de leitura e ambas inserir — uma
reserva dupla (double-booking).

Agravante: o `README.md` afirmava que isso já era prevenido no banco ("índices
únicos parciais no banco previnem condições de corrida"). **Nenhum índice desse
tipo existia** em `reservations` ou `blockings` (`src/db/schema.ts:108-140`). A
documentação prometia uma garantia inexistente.

O modelo de horário já é **horário-a-horário (grade horária)**: os tempos são
sempre cheios (`HH:00`, com fim até `24:00`), `intervalsOverlap` é semiaberto
(`08:00–09:00` e `09:00–10:00` não colidem) e `buildHourlyAvailability`
(`src/lib/schedule.ts:81`) já decompõe o dia em 24 fatias de uma hora. Apenas o
lado de **escrita** ainda guarda intervalos em vez da grade.

## Restrições que moldam a decisão

- **Plataforma**: Cloudflare D1 (SQLite). SQLite **não** tem restrições de
  exclusão por intervalo; para obter não-sobreposição garantida pelo banco é
  preciso discretizar a reserva em fatias horárias e usar uma restrição de
  unicidade. Postgres **tem** `EXCLUDE USING gist (... WITH &&)`, que garante
  não-sobreposição real na própria tabela, sem discretização.
- **Roadmap**: a migração D1 → Postgres está prevista (`README`), mas é item de
  "algum dia" — **não confiável no curto prazo**. O POC permanecerá em D1,
  restrito ao IAUD, por um tempo.
- **Escala atual**: um departamento, poucos espaços, poucos usuários. A corrida
  realista é o **double-submit** (mesmo usuário, clique duplo / retry do cliente
  → slot idêntico em milissegundos), não dois usuários distintos disputando
  sobreposições parciais.
- **Invariante de domínio**: reserva é sempre do **espaço inteiro**
  (single-occupancy). Um espaço fisicamente divisível é modelado como **dois
  espaços** distintos. Logo "no máximo um ocupante por espaço/hora" vale para
  sempre.

## Decisão

Adotar uma estratégia em **três estágios**, escolhendo o enforcement conforme a
plataforma e a escala reais — em vez de construir agora uma máquina pesada que
seria demolida na migração para Postgres.

### Estágio 1 — Agora (POC, D1, IAUD)

- Índice único parcial para **duplicata exata**:
  `UNIQUE(space_id, date, start_time, end_time) WHERE status = 'confirmed'`.
  Mata a corrida de double-submit (a de maior frequência) e torna a afirmação do
  README verdadeira para o caso comum.
- Manter a verificação em nível de aplicação (`checkSlotAvailability`) para a
  mensagem de conflito amigável e para sobreposições parciais.
- Traduzir a violação de unicidade em `ConflictError` em vez de 500.
- Corrigir a documentação para descrever a postura real, incluindo a **lacuna
  residual**: sobreposições *parciais* simultâneas ainda não são bloqueadas pelo
  banco neste estágio.

Implementado em `plans/003-double-booking-guard-and-doc-fix.md`.

### Estágio 2 — Sob gatilho (escala em D1): grade horária de ocupação

Refatorar para enforcement real no banco via **tabela de ocupação compartilhada**
(detalhe em `plans/004-occupancy-grid-overlap-enforcement.md`):

- `reservations` e `blockings` permanecem como **duas tabelas-pai distintas**
  (cada uma com seus atributos, ciclo de vida e RBAC — **não** fundir em uma
  tabela "balde" com colunas nuláveis).
- Uma tabela-filha **compartilhada** `occupancy_slots(space_id, date, hour,
  kind, ref_id)` com `PK(space_id, date, hour)` — a chave composta **é** a
  garantia de unicidade. Ocupação **baseada em presença**: a linha existe apenas
  enquanto o slot está ativo; cancelar/sobrescrever/remover **apaga** as linhas.
  Histórico permanece nas tabelas-pai.
- Um **`OccupancyService` dedicado** é o **único** código que escreve em
  `occupancy_slots`. Toda mutação é um **único `db.batch([...])`** — uma
  duplicata concorrente faz o batch inteiro falhar atomicamente; a falha é
  traduzida em `ConflictError`. A corretude deixa de depender da verificação
  prévia (que permanece só pela mensagem).
- O **override de bloqueio** vira **evict-then-claim atômico** dentro do
  chokepoint: apagar as linhas de ocupação da reserva, marcar a reserva-pai como
  `overridden`, notificar, e então inserir as linhas de ocupação do bloqueio.

**Gatilho composto** — executar quando *qualquer* ocorrer:
- **(a)** um segundo departamento com usuários reais (não-teste) criando reservas
  entrar em produção **em D1**; ou
- **(b)** qualquer double-booking real for observado em produção (audit log /
  relato de usuário).

**Off-ramp**: se uma migração para Postgres comprometida e agendada acontecer
antes de (a)/(b), **pular** este estágio e ir direto ao Estágio 3.

### Estágio 3 — Migração para Postgres: restrição de exclusão

Quando/se o Postgres entrar, a correção real é uma única linha de DDL na própria
tabela `reservations`, sem tabela-filha e sem dupla-escrita:

```sql
ALTER TABLE reservations ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (
    space_id WITH =,
    daterange(date, date, '[]') WITH &&,
    int4range(start_hour, end_hour) WITH &&   -- semiaberto [), igual ao intervalsOverlap
  ) WHERE (status = 'confirmed');
```

Se o Estágio 2 já tiver sido implementado, a `occupancy_slots` torna-se
redundante e pode ser removida — a restrição de exclusão passa a ser a única
fonte da garantia.

## Opções consideradas e rejeitadas

- **Construir a grade horária agora, no POC.** Rejeitada: paga-se uma refatoração
  grande e uma invariante de dupla-escrita permanente durante todo o POC, para
  proteger contra carga que não existe ainda, e provavelmente demole-se tudo na
  migração para Postgres. "Pronto para escala" ≠ "construir a máquina de escala
  agora" — é ter a decisão documentada e pronta para executar sob gatilho.
- **`reservation_slots` apenas para reservas (grade não-compartilhada).**
  Considerada e preterida em favor da tabela de ocupação **compartilhada**:
  reads ficam mais limpos (uma tabela em vez de mesclar reservas + bloqueios) e a
  exclusão mútua reserva-vs-bloqueio passa a ser garantida pelo banco. Custo
  aceito: o override vira evict-then-claim.
- **Fundir `reservations` e `blockings` em uma tabela única** com discriminador e
  colunas nuláveis. Rejeitada: tabela "balde" que mistura dois state machines
  (`confirmed/canceled/overridden` vs `active/removed`), RBAC e validadores —
  menos legível a longo prazo, não mais.
- **Contador de ocupação por slot (capacity-aware / seat-level).** Fora de
  escopo: contradiz o invariante de espaço-inteiro. Se algum dia houver reserva
  por assento/capacidade, é um modelo diferente e um ADR próprio — não estende a
  grade de unicidade.

## Consequências

- O POC ganha proteção barata contra a corrida mais frequente sem nova
  arquitetura descartável.
- A correção real fica especificada, versionada e atrelada a um gatilho
  observável — pronta para execução sem recarregar todo este contexto.
- Permanece a lacuna residual (sobreposição parcial concorrente) até o Estágio 2
  ou 3. Aceita conscientemente para a fase de POC.
- O invariante single-occupancy fica registrado como permanente; quem mexer na
  modelagem de espaços divisíveis deve criar espaços distintos, não relaxar a
  unicidade.
</content>
