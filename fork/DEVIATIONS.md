# Fork deviations from upstream Actual

This log lists every place the `multicurrency` branch of
[jessedyck/actual](https://github.com/jessedyck/actual) differs from
[actualbudget/actual](https://github.com/actualbudget/actual). Its purpose is
to let the fork adopt upstream's own multi-currency work piece by piece and
retire fork code as it does.

- **Forked from:** `832f43da` (upstream `master`, 2026-10-13)
- **Last upstream sync:** `832f43da`
- **Branches:** `master` mirrors upstream and is never committed to. All fork
  work lives on `multicurrency`, which is what the Docker image is built from.

## Finding fork code

- Every edit to an upstream file carries a `[fork:mc D-xxx]` comment pointing
  at an entry below: `git grep -n "\[fork:mc"`.
- Fork-owned files (no upstream counterpart, so they never conflict):
  - `fork/`
  - `.github/workflows/fork-docker.yml`
  - `packages/loot-core/migrations/1791961050603_mc_multi_currency.sql`
  - `packages/loot-core/migrations/1792130000000_mc_budget_currency.sql`
  - `packages/loot-core/src/server/multi-currency/`
  - `packages/loot-core/src/shared/multi-currency.ts` (and its test)
  - `packages/loot-core/src/types/models/mc-exchange-rate.ts`
  - `packages/desktop-client/src/components/multi-currency/`
  - `packages/desktop-client/src/hooks/useMultiCurrency.ts`
  - `packages/desktop-client/src/hooks/useMultiCurrencyFormat.ts`
  - `packages/desktop-client/src/hooks/useMcAccountBalance.ts`
  - `packages/desktop-client/src/hooks/useMcRate.ts`
  - `packages/desktop-client/src/hooks/useAccountCurrencyRegister.ts`
  - `packages/desktop-client/src/hooks/useMcBudgetAmountTitle.ts`
  - `packages/desktop-client/src/hooks/useMcAccountListView.ts`
  - `packages/desktop-client/src/hooks/useMcDisplayCurrency.ts`
  - `packages/desktop-client/src/hooks/useMcReportCurrency.ts`
  - `packages/desktop-client/src/reports/mcReportValuation.ts`
  - `packages/desktop-client/src/reports/mcBudgetCells.ts` (and its test)
  - `packages/desktop-client/src/accounts/mcReconciliation.ts`
  - `packages/desktop-client/src/accounts/mcRevaluation.ts`
  - `packages/desktop-client/src/transactions/mcRules.ts`
  - `packages/desktop-client/src/util/mcErrorMessage.ts`
  - `packages/desktop-client/src/hooks/useMcAmountCellFormatter.ts`
- Everything the fork stores is prefixed `mc_` (columns, the rate table,
  synced preference keys). An upstream migration can therefore never collide
  with fork data, even if upstream picks names like `currency`.

## Core decision: what `amount` means

`transactions.amount` keeps its upstream meaning: the value in the
**default currency** (upstream's single budget currency,
`defaultCurrencyCode`). Balances, transfers, To Budget and reports keep
working unchanged and older or official clients still see correct numbers. A
foreign-currency account additionally stores `mc_amount`, the amount in the
account's own currency (in that currency's minor units). A category's budget
for a month can have a currency of its own (D-017); a transaction counted in
such a budget also stores `mc_budget_amount`, its value in that currency.
Upstream may choose the opposite (make `amount` the account currency); if
so, reconciling needs a data migration, described under D-002.

## Deviation register

| ID    | Area                                                          | Upstream files touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status                                                                                       |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| D-001 | `multiCurrency` experimental flag                             | `loot-core/src/types/prefs.ts`, `desktop-client/src/hooks/useFeatureFlag.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Done                                                                                         |
| D-002 | Schema: account currency, account-currency amount, rate table | `loot-core/src/server/aql/schema/index.ts`, `loot-core/src/server/db/types/index.ts`, `loot-core/src/types/models/{account,transaction,index}.ts`, 4 snapshot files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Done                                                                                         |
| D-003 | Shared conversion helpers                                     | none (fork-owned)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Done                                                                                         |
| D-004 | Exchange rates: synced cache, Frankfurter, manual rates       | `loot-core/src/types/prefs.ts` (pref keys)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done                                                                                         |
| D-005 | Server handlers, account currency on creation, backfill       | `loot-core/src/server/main.ts`, `loot-core/src/types/handlers.ts`, `loot-core/src/server/accounts/app.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Done                                                                                         |
| D-006 | Keep `amount` and `mc_amount` consistent on every write       | `loot-core/src/server/transactions/index.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Done                                                                                         |
| D-007 | Settings: flag toggle, rate settings, default-currency lock   | `desktop-client/src/components/settings/{Experimental,index,Currency}.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done                                                                                         |
| D-008 | Reconcile and imports in the account currency                 | `desktop-client/src/components/accounts/{Header,Account}.tsx`, `desktop-client/src/components/modals/{AccountReconcileModal,ImportTransactionsModal/ImportTransactionsModal}.tsx`, `desktop-client/src/components/mobile/accounts/{AccountTransactions,ReconcilingBanner}.tsx`, `loot-core/src/server/accounts/sync.ts`                                                                                                                                                                                                                                                                                                                                                                                                      | Done                                                                                         |
| D-009 | Docker image built from this branch                           | none (fork-owned workflow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Done                                                                                         |
| D-010 | Fork docs and notices                                         | `README.md` (notice at the top)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Done                                                                                         |
| D-011 | Client hooks: multi-currency state, per-currency formatting   | none (fork-owned)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Done                                                                                         |
| D-012 | Accounts: currency on create and change, balances             | `loot-core/src/server/accounts/app.ts` (`accounts-get`), `desktop-client/src/accounts/mutations.ts`, `desktop-client/src/modals/modalsSlice.ts`, `desktop-client/src/components/{Modals,modals/CreateLocalAccountModal,modals/AccountMenuModal,accounts/Header,accounts/Account,sidebar/Account,mobile/accounts/AccountsPage,mobile/transactions/TransactionListWithBalances}.tsx`, `loot-core/src/types/prefs.ts` (pref key)                                                                                                                                                                                                                                                                                                | Done                                                                                         |
| D-013 | Register: amounts in the account's currency                   | `desktop-client/src/components/transactions/{TransactionList,TransactionsTable}.tsx`, `desktop-client/src/components/accounts/Account.tsx`, `desktop-client/src/components/mobile/{accounts/AccountTransactions,transactions/TransactionEdit}.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Done                                                                                         |
| D-014 | Exchange rate adjustment                                      | none (fork-owned)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Done (desktop)                                                                               |
| D-015 | Reports in a display currency                                 | `loot-core/src/types/prefs.ts` (pref key), `desktop-client/src/hooks/useFormat.ts`, `desktop-client/src/components/reports/spreadsheets/{net-worth-spreadsheet,custom-spreadsheet,grouped-spreadsheet,fetchSpreadsheetQueryData,spending-spreadsheet}.ts`, `desktop-client/src/components/reports/spreadsheets/cash-flow-spreadsheet.tsx`, `desktop-client/src/components/reports/reports/{NetWorth,NetWorthCard,CashFlow,CashFlowCard,CustomReport,GetCardData,Spending,SpendingCard,Summary,SummaryCard,CalendarCard,BudgetAnalysis,BudgetAnalysisCard}.tsx`, `desktop-client/src/components/reports/spreadsheets/{summary,calendar,budget-analysis}-spreadsheet.ts`, `desktop-client/src/components/reports/Overview.tsx` | Done for net worth, cash flow, custom, spending, summary, budget analysis and calendar cards |
| D-016 | Changing the budget currency (replaced by D-017)              | (see D-017)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Retired                                                                                      |
| D-017 | A currency on each budget; changing the default currency      | `loot-core/src/server/budget/*`, `loot-core/src/server/api.ts`, budget page and budget menus (desktop and mobile), report spreadsheets that read budgets, `hooks/useFormulaExecution.ts`, `settings/Currency.tsx`, `global-events.ts`, modal registry, schema, 4 snapshot files (full list under D-017)                                                                                                                                                                                                                                                                                                                                                                                                                      | Done                                                                                         |
| D-018 | Rules and schedules in the account's currency                 | `loot-core/src/server/transactions/transaction-rules.ts`, `loot-core/src/server/schedules/{app,find-schedules}.ts`, `loot-core/src/server/forecast/forecast-schedules.ts`, `desktop-client/src/components/schedules/{SchedulesTable,ScheduleEditForm,ScheduleEditModal}.tsx`, `desktop-client/src/components/rules/{RuleRow,RuleEditor}.tsx`, `desktop-client/src/components/mobile/{schedules/SchedulesListItem,rules/RulesListItem}.tsx`, `desktop-client/src/components/transactions/SimpleTransactionsTable.tsx`                                                                                                                                                                                                         | Done                                                                                         |

### D-001: `multiCurrency` flag

Adds `'multiCurrency'` to `FeatureFlag` and its default (`false`). The
feature only activates with the flag on **and** a default currency set through
upstream's experimental _Currency support_ (`defaultCurrencyCode`).

_Reconcile:_ when upstream ships per-account currencies, remove the flag and
its checks; the stored data stays valid.

### D-002: Schema

Migration `1791961050603_mc_multi_currency.sql`:

- `accounts.mc_currency` TEXT: ISO 4217 code, NULL = default currency.
- `transactions.mc_amount` INTEGER: amount in the account currency, in its
  minor units (JPY has none, KWD has three). NULL for default-currency
  accounts.
- `mc_exchange_rates` (synced): `id` = `YYYYMMDD:BASE:QUOTE`, `date`, `base`,
  `quote`, `rate` (1 base = rate quote), `source` (`frankfurter` | `manual`).

Migration `1792130000000_mc_budget_currency.sql` adds the budget currency
columns of D-017: `zero_budgets.mc_currency`, `reflect_budgets.mc_currency`
and `transactions.mc_budget_amount`.

Exposed with the same names in the AQL schema and TypeScript types. Adding a
column changes `SELECT *` results, so these snapshot files were regenerated
(the only change is `"mc_amount": null` and `"mc_budget_amount": null`
lines, and shifted diff offsets):
`server/__snapshots__/main.test.ts.snap`,
`server/accounts/__snapshots__/sync.test.ts.snap`,
`server/transactions/__snapshots__/transfer.test.ts.snap`,
`server/transactions/import/__snapshots__/parse-file.test.ts.snap`.

_Reconcile:_ when upstream adds its own columns, add a fork migration that
copies `mc_currency` / `mc_amount` (and rates) into upstream's fields,
switch fork code to them, and stop writing the `mc_` columns. Never drop
them: upstream's migrations must stay additive-only for cross-version sync.
If upstream redefines `amount` as the account currency, the copy becomes
`amount := mc_amount` for foreign accounts, with the budget value moved to
whatever field upstream uses.

### D-003: Shared helpers

`shared/multi-currency.ts`: account currency lookup, minor-unit conversion
with symmetric rounding (so transfers mirror exactly), implied rate, rate id.

### D-004: Exchange rates

`server/multi-currency/rates.ts` and `frankfurter.ts`. Lookup order: local
synced table (reusing a rate up to 7 days old, for weekends) → Frankfurter v2
(`/v2/rates`) when online rates are on → nothing (conversion stays pending).
Future dates use today's rate. Bulk work fetches one date range per currency.
A downloaded rate never replaces a manual one. Rates are stored outside undo.

Transactions and budgets convert at a **month rate**, the average of the
month's daily rates (D-017); daily rates remain the source, and reports
(D-015) still pick their own dates.

Synced preferences: `mcRatesOnline` (`'false'` disables downloads; default
on) and `mcRatesUrl` (default `https://api.frankfurter.dev/v2`; Frankfurter
can be self-hosted). Requests only carry currency codes and dates.

_Reconcile:_ if upstream adds a rate table or provider, migrate the rows and
switch lookups to it.

### D-005: Handlers and account currency

New handlers (`server/multi-currency/app.ts`, registered in `server/main.ts`,
typed in `types/handlers.ts`): `mc-get-context`, `mc-get-rate`, `mc-convert`,
`mc-rates-list`, `mc-rate-set`, `mc-rate-delete`, `mc-rates-fetch`,
`mc-account-set-currency`, `mc-recompute-pending`.

`account-create` (`server/accounts/app.ts`) accepts `mc_currency`; the
starting balance is then taken in that currency and converted.

`mc-account-set-currency` backfills existing transactions: it reads the
amount written by the documented rule-template workaround
(`52.43 AUD (FX rate: 0.65) • …`) when present, otherwise converts the budget
amount at each transaction's date. Notes are left untouched.

### D-006: Consistent amounts on every write

`prepareMultiCurrencyChanges` runs first in `batchUpdateTransactions`, and
`fillTransferMirrors` runs after transfers are processed
(`server/transactions/index.ts`). Rules, for a foreign-currency account:

- A new transaction with only `mc_amount` gets `amount` derived; with only
  `amount` (older clients, API, transfer mirrors) gets `mc_amount` derived.
- Editing `mc_amount` re-derives `amount`; editing `amount` alone is kept as
  a manual override (the real bank conversion).
- In a transfer with a default-currency side, that side's amount is
  authoritative and the foreign side mirrors it; between two foreign
  accounts the sending side derives and the receiving side mirrors. A
  receiving side's `mc_amount` is only filled when empty, never overwritten.
- Moving to an account in another currency re-derives `mc_amount`; moving to
  a default-currency account clears it.
- Amounts convert at the month's average rate (D-017), not the day's.
- A transaction counted in a budget with its own currency gets
  `mc_budget_amount`, its value in that currency (D-017).
- No rate: `amount` (or `mc_budget_amount`) is 0 until
  `mc-recompute-pending` finds one.
- Split children are rounded to add up exactly to the parent.

Writes that bypass `batchUpdateTransactions` get no account amount until
`mc-recompute-pending` derives one from `amount`: the API's
`addTransactions` without `runTransfers`, and bank sync's starting balance
for a newly linked account (which is then read as a budget amount; not
handled). A new account's starting balance is handled by D-005, imports by
D-008.

_Reconcile:_ remove both call sites once upstream converts amounts itself.

### D-007: Settings

- _Experimental features_: **Multi-currency accounts** is a sub-feature of
  upstream's **Currency support**, which can't be switched off while it is on
  (`settings/Experimental.tsx`).
- _Settings_ shows the fork's **Multi-currency accounts** group when the flag
  is on, and no longer clears `defaultCurrencyCode` when Currency support is
  off while multi-currency is on (`settings/index.tsx`; upstream clears it
  whenever the currency flag is off).
- The default-currency picker is disabled while any account or budget has a
  currency of its own (`settings/Currency.tsx`): existing amounts would
  otherwise be read in the wrong currency. Its description points to _Change default currency_
  (D-017).
- Fork-owned rows in `components/multi-currency/`: automatic downloads
  (`mcRatesOnline`), service URL (`mcRatesUrl`), budget values waiting for a
  rate (`mc-recompute-pending`), and the stored rates with manual entry and
  deletion. Saving a manual rate also fills in pending budget values. The
  group's description says that an account keeps one currency and each
  month's budgets count its transactions in their own currency.

_Reconcile:_ remove the nesting and both guards with the flag. If upstream
adds rate settings, move `mcRatesOnline` / `mcRatesUrl` into them.

### D-008: Reconcile and imports in the account's currency

**Reconcile** (desktop). For a foreign-currency account the statement
balance is typed in the account's currency and compared with the cleared sum
of `mc_amount`:

- `accounts/Header.tsx` renders the fork's `McReconcileMenu` and
  `McReconcilingMessage` instead of upstream's `ReconcileMenu` and
  `ReconcilingMessage`. The last balance from bank sync is shown in the
  account's currency, since that is what the bank reports.
- `accounts/Account.tsx` finishes reconciling and creates the adjustment
  through the fork's `accounts/mcReconciliation.ts` (prop
  `isAccountCurrencyView`, D-013). The adjustment stores `mc_amount`; the
  server derives its budget amount (D-006).

**Reconcile** (mobile), same rules:

- `modals/AccountReconcileModal.tsx` starts from the cleared sum of
  `mc_amount` and hands on the statement balance in the currency's minor
  units (its input counts hundredths, like every amount input). Its prompt
  names the currency ("…, in CAD, …") while multi-currency is on.
- `mobile/accounts/ReconcilingBanner.tsx` compares with the cleared sum of
  `mc_amount` and formats in the account's currency.
- `mobile/accounts/AccountTransactions.tsx` finishes and creates the
  adjustment through `mcReconciliation.ts`.

**Imports** (CSV, OFX, QIF and CAMT files, bank sync, and the API's
`importTransactions`). Amounts sent for a foreign-currency account are read
in the account's currency, in hundredths like every amount the API takes:

- `server/accounts/sync.ts` (`matchTransactions`): right after the
  transactions are normalized, the fork's `readImportedAmounts`
  (`server/multi-currency/imports.ts`) moves each amount to `mc_amount` and
  converts `amount` at the transaction's date, so the budget value is known
  before duplicate matching. Rules see the account amount (D-018). A
  transaction that already carries `mc_amount` keeps both amounts. Split
  children only get `mc_amount`; D-006 derives and rounds their budget
  amounts.
- Duplicate matching compares account amounts, falling back to `amount` for
  rows whose conversion is pending: both fuzzy-match queries also select
  `mc_amount` and take their amount condition from `getImportAmountMatch`
  (upstream's `amount = ?` for other accounts).
- `reconcileTransactions`: the import preview shows a matched transaction's
  amount in the account's currency (`getImportPreviewAmount`), like the
  file's amounts next to it.
- `ImportTransactionsModal.tsx`: a note under _Amount options_ says which
  currency the file's amounts are read in (`McImportCurrencyNote`).

The API's `addTransactions` still takes budget amounts, as everywhere else
in the API (D-006 derives the account amount). Transactions posted by
schedules take the schedule's amount in the account's currency (D-018).

_Reconcile:_ remove the fork components, `mcReconciliation.ts` and the
branches in `Header.tsx`, `Account.tsx`, `AccountReconcileModal.tsx`,
`ReconcilingBanner.tsx` and the mobile `AccountTransactions.tsx` once
upstream reconciles in the account's currency; remove the `readImportedAmounts` call, the amount
conditions and the preview amount from `sync.ts` once upstream imports into
account currencies. Upstream will most likely read imported amounts in the
account's currency too, so imports into converted accounts keep working.

### D-012: Accounts

- **New accounts** (`modals/CreateLocalAccountModal.tsx`,
  `accounts/mutations.ts`): a currency picker (fork
  `AccountCurrencyField`); the starting balance is typed in that currency
  and converted by the server (D-005).
- **Changing an account's currency**: _Change currency…_ in the account
  menu (`accounts/Header.tsx`, handled in `accounts/Account.tsx`) and in the
  mobile account menu (`modals/AccountMenuModal.tsx`) opens the fork modal
  `mc-account-currency` (registered in `modals/modalsSlice.ts` and
  `components/Modals.tsx`), which calls `mc-account-set-currency` (backfill,
  D-005). It names the current currency and offers two ways, each with the
  balance it would give: **Convert** (the money really changed currency:
  transactions keep their default-currency value and get amounts in the new
  currency, from workaround notes or at each month's rate) and **Keep the
  numbers** (`convert: false`, an account set up in the wrong currency:
  amounts keep their numbers in the new currency and their
  default-currency value is worked out again; split parents add up their
  children, transfers keep the other account's value).
- **Balances**: the sidebar (`sidebar/Account.tsx`) and the mobile account
  list (`mobile/accounts/AccountsPage.tsx`) render the fork's `McCellValue`
  instead of `CellValue`: the account's own currency for foreign accounts,
  upstream's `CellValue` otherwise. The account header (`accounts/Header.tsx`)
  renders the fork's `McAccountBalances` instead of `Balances` for foreign
  accounts: balance in the account currency, its value today in the budget
  currency, and _In budget_ (the sum of `amount`). An info button (fork
  `McBalancesHelp`) explains the three with the account's own numbers and
  why _Worth today_ and _In budget_ differ. Group totals (On budget,
  Off budget, All accounts) stay default-currency sums of `amount`; on the
  mobile account list a currency picker in the header (fork
  `McAccountTotalsSelect`, synced preference `mcTotalsCurrency`, key added in
  `types/prefs.ts`) shows them instead in another currency, every account's
  own balance at today's rate (`mc-account-totals`, fork
  `McAccountTotalsProvider` / `McAccountTotal`). The
  mobile account page (`mobile/transactions/TransactionListWithBalances.tsx`,
  new prop `mcAccount`) shows balance, cleared and uncleared the same way.
- **Server**: `accounts-get` (`server/accounts/app.ts`) maps account rows
  field by field; it now includes `mc_currency`.

Not yet: selected balances show default-currency sums.

_Reconcile:_ swap `McCellValue` / `McAccountBalances` back to upstream's
components once upstream formats balances per account currency; keep the
`accounts-get` field until upstream returns the account currency itself.

### D-013: Register in the account's currency

The register's logic (inputs, splits, running balance, new rows) only knows
`amount`. For a single foreign-currency account the fork swaps the two
amounts at the register's boundary instead of changing that logic:

- `TransactionList.tsx` passes transactions through
  `useAccountCurrencyRegister` (fork hook over `toAccountCurrencyView` in the
  fork's shared helpers): `amount` holds the account amount and the budget
  amount waits in `_mcBudgetAmount`. Changes going up (`onChange`) are
  swapped back; diffs going to the server go through
  `diffFromAccountCurrencyView`, which turns an edited `amount` into
  `mc_amount` and leaves the budget amount for the server to derive (D-006).
  Rules run on real fields and can't change the amount being typed.
- The register counts amounts in hundredths whatever the currency, while
  `mc_amount` uses the currency's own minor units. For currencies without
  decimals (JPY, KRW, IRR) the view scales amounts on the way in and out
  (`minorUnitsToHundredths` / `hundredthsToMinorUnits`); for two-decimal
  currencies nothing changes.
- Rows with no stored account amount (pending conversions) show an estimate
  at today's rate, never stored. A schedule preview shows the schedule's
  amount, already in the account's currency (D-018); its budget amount is
  the estimate.
- `Account.tsx`: running and filtered balances sum `mc_amount` for these
  accounts (new prop `isAccountCurrencyView`). `AllTransactions` puts the
  running balances and scheduled previews into the view before adding them
  up, so previews continue the balance in the account's currency.
- `TransactionsTable.tsx`: the Payment and Deposit tooltips show the budget
  amount (`useMcBudgetAmountTitle`).
- Views with several accounts (All accounts, On budget, a category's
  transactions) show each transaction in its own account's currency, with
  the currency's symbol: `useAccountCurrencyRegister(account, { mixed })`
  converts row by row (`toAccountCurrencyViews`,
  `diffFromAccountCurrencyViews`), and the Payment, Deposit and running
  balance cells add the symbol (fork hook `useMcAmountCellFormatter`; the
  running balance stays in the default currency). `useAmountColumnWidths`
  takes a new optional `symbolChars` so the columns fit the symbols.

Mobile:

- `mobile/accounts/AccountTransactions.tsx`: a foreign-currency account's
  page lists its transactions and scheduled previews in its currency, with
  running balances recomputed from those amounts (fork hook
  `useMcAccountListView`).
- `mobile/transactions/TransactionEdit.tsx`: the editor holds each
  transaction with its amount in its account's currency
  (`toAccountCurrencyViews`) and waits for the accounts to load before
  fetching. On save, `diffFromAccountCurrencyViews` stores a typed amount in
  the currency of the account the transaction ends up in: `mc_amount` for a
  foreign-currency account, `amount` otherwise. A change that doesn't touch
  the amount (for example moving to another account) keeps the stored
  amounts, and the server converts as in D-006. The currency is named under
  the amount (`McAmountCurrencyHint`).
- Rules on a transaction typed in a foreign-currency account (desktop and
  mobile) run through `transactions/mcRules.ts`: they get the account amount
  as `mc_amount` and a budget amount of 0. Amount conditions compare the
  typed amount (D-018), but rules can't change it.

Not yet: while a transaction is typed in a foreign-currency account, rules
can't change its amount or split it (imported transactions can be).

_Reconcile:_ remove the swap from `TransactionList.tsx`, the prop, both
sums and the `AllTransactions` conversion in `Account.tsx`, and the tooltip,
the cell formatter and the `symbolChars` parameter in
`TransactionsTable.tsx` once upstream's register handles account
currencies.

### D-014: Exchange rate adjustment

A foreign-currency account's budget value is the sum of its `amount`s, each
converted when it was recorded, so it drifts from what the balance is worth
at today's rate. The account header (fork `McAccountBalances`) shows
_Adjust to today's value…_ whenever the two differ. It records a cleared
transaction dated today with the difference as `amount`, `mc_amount` 0 and
the note "Exchange rate adjustment" (`accounts/mcRevaluation.ts`, through
the rules so a rule on the note can categorize it). The account's balance in
its own currency doesn't change. It is refused while the account has
pending conversions, which would make the difference wrong. D-006 keeps
both amounts as given because `mc_amount` is set.

Not yet: mobile.

_Reconcile:_ keep as long as upstream stores default-currency amounts per
transaction; drop it if upstream values foreign accounts at current rates
itself.

### D-015: Reports in a display currency

- **Choice**: synced preference `mcReportCurrency` (key added in
  `types/prefs.ts`; empty means the default currency), picked with the fork's
  `McReportCurrencySelect` in a supported report's header, or for the whole
  dashboard in its header (fork `McDashboardCurrencySelect`,
  `reports/Overview.tsx`, desktop and mobile), and shared by all supported
  reports and dashboard cards. It only takes effect while a rate
  from the default currency exists (checked with today's rate); otherwise the
  report stays in the default currency and the picker says "No rate".
- **Formatting**: `hooks/useFormat.ts` reads the fork context
  `McDisplayCurrencyContext`, so amounts inside a supported report are
  formatted in its currency (symbol and decimals). `McReportCurrencyProvider`
  wraps only supported reports, so the others keep the default currency.
- **Rates**: server handler `mc-rates-at` (`getRatesAt` in
  `server/multi-currency/rates.ts`) returns rates for a list of dates. It
  fetches missing ones once as a range, then each date takes the newest rate
  on or before it, else the oldest one after it.
- **Net worth** (`spreadsheets/net-worth-spreadsheet.ts`, new optional last
  parameter; `reports/NetWorth.tsx` and `reports/NetWorthCard.tsx` wrap
  themselves in the provider and pass it). A foreign-currency account's
  balances are summed from `mc_amount` and valued at the rate of each
  period's end (fork `reports/mcReportValuation.ts`). The report therefore
  shows what the accounts were worth, exchange rate gains and losses
  included, rather than the rates their transactions were recorded at; this
  applies in the default currency too. Every balance is then converted into
  the display currency, through the default currency, at the same date.
  Internal transfer legs are moved in the units their account is summed in.
  An account in a currency with no rate at all keeps its budget amounts.
- **Cash flow** (`spreadsheets/cash-flow-spreadsheet.tsx`, new optional last
  parameter on `cashFlowByDate` and `simpleCashFlow`; `reports/CashFlow.tsx`
  and `reports/CashFlowCard.tsx` as for net worth). In another currency each
  day's flows are converted at that day's rate, or each month's at the
  average of its daily rates when the page shows months; the balance starts
  from the converted opening balance and adds the converted flows. The card's
  totals are grouped and converted the same way (`simpleCashFlow`'s query
  was split into `makeBaseQuery` for that), so card and page agree. In the
  default currency nothing changes: flows already carry the rates their
  transactions were recorded at.

- **Custom reports** (page `reports/CustomReport.tsx`, dashboard cards
  `reports/GetCardData.tsx`): `fetchSpreadsheetQueryData` (the data fetch
  shared by `custom-spreadsheet.ts` and `grouped-spreadsheet.ts`, which pass
  the new `mcValuation` prop through) converts each row, one period's sum,
  at that period's rate before the report adds rows up: a day's rate, or the
  average of the daily rates of a month or a year. Budgeted amounts are
  converted the same way by month.
- **Spending** (`spreadsheets/spending-spreadsheet.ts`, new `mcValuation`
  prop; `reports/Spending.tsx` and `reports/SpendingCard.tsx`): each day's
  spending at that day's rate, the compared month's budget at that month's
  average rate.
- **Summary** (`spreadsheets/summary-spreadsheet.ts`, new optional last
  parameter; `reports/Summary.tsx` with the picker and
  `reports/SummaryCard.tsx`): sums are taken per day and each converted at
  its month's average rate, the divisor of a percentage too.
- **Calendar card** (`spreadsheets/calendar-spreadsheet.ts`, new optional
  last parameter; `reports/CalendarCard.tsx`): each day's income and
  spending at its month's average rate. The calendar page stays in the
  default currency, since it lists transactions.
- **Budget analysis** (`spreadsheets/budget-analysis-spreadsheet.ts`, new
  `mcValuation` prop; `reports/BudgetAnalysis.tsx` with the picker and
  `reports/BudgetAnalysisCard.tsx`): each month's budgeted, spent, balance
  and overspending adjustment at that month's average rate; the totals add
  them up.

Every report that shows budgets first adds them up in the default currency,
each at its month's rate (D-017).

Not yet: the other reports (calendar page, Sankey, crossover, age of money,
forecasts) stay in the default currency. Long
amounts in another currency's format can be cut off on chart axes and in
narrow table columns, as they are upstream for budgets in such a
currency.

_Reconcile:_ drop the provider, the picker and the preference once upstream
reports offer a currency; keep valuing foreign accounts in the net worth
spreadsheet until upstream does it.

### D-016: Changing the budget currency (retired)

Replaced by D-017. The first version moved the whole history to the new
currency; budgets now keep their own currency instead, and changing the
default currency only touches what has none. `switch.ts` became
`default-currency.ts`, the `mc-switch-*` handlers and `Switch*` components
are gone, and the markers now say D-017.

### D-017: A currency on each budget

The default currency (`defaultCurrencyCode`, upstream's single budget
currency) stays the currency of `transactions.amount`, To Budget, group and
account totals. Each category's budget in each month can have a currency of
its own, so a budget file can move from CAD to EUR one budget at a time.

Upstream files touched: `loot-core/src/server/budget/{base,envelope,
tracking,actions}.ts`, `loot-core/src/server/aql/schema/index.ts`,
`loot-core/src/server/db/types/index.ts`,
`loot-core/src/types/{prefs.ts,models/transaction.ts}`, the 4 snapshot files
of D-002, `desktop-client/src/components/budget/{index,ExpenseCategory,
IncomeCategory}.tsx`, `budget/{envelope,tracking}/{BudgetMenu,
*BudgetComponents,budgetsummary/BudgetSummary}.tsx`,
`mobile/budget/{BudgetPage,BudgetTable,ExpenseCategoryListItem,
IncomeCategoryListItem}.tsx`, `modals/{Envelope,Tracking}BudgetMenuModal.tsx`,
`settings/Currency.tsx`, `desktop-client/src/global-events.ts`,
`desktop-client/src/modals/modalsSlice.ts`, `components/Modals.tsx`,
`loot-core/src/server/{budget/app,api}.ts`,
`desktop-client/src/components/reports/spreadsheets/{budgetDataQuery,
budget-analysis-spreadsheet,spending-spreadsheet}.ts` and
`desktop-client/src/hooks/useFormulaExecution.ts`.

- **Data** (migration `1792130000000_mc_budget_currency.sql`, D-002):
  - `zero_budgets.mc_currency` / `reflect_budgets.mc_currency`: the budget's
    own currency. NULL: the default currency.
  - `transactions.mc_budget_amount`: the transaction's value in its budget's
    currency when that isn't the default one; NULL without a category, in an
    off-budget account, for a split parent, or for a budget in the default
    currency. 0 while no rate is known (counted by `mc-recompute-pending`,
    except an exchange rate adjustment, which is 0 in its account's
    currency).
  - Synced preferences (`types/prefs.ts`): `mcMonthRates`, JSON
    `{"YYYY-MM:BASE:QUOTE": {rate, manual?, final?}}`. Legacy
    `mcCurrencyPeriods` (JSON `[{currency, until: "YYYY-MM"}]`), a date rule
    the first version of _Change default currency_ stored, is moved onto the
    budgets it covered and cleared when a budget file opens
    (`migrateCurrencyPeriods`); no date rule is stored any more.
- **Month rates** (`server/multi-currency/month-rates.ts`): every conversion
  uses one rate per month and currency pair, the average of the month's
  stored daily rates up to today. A month without rates yet (a future one)
  takes the latest rate before it. A month is final once it is over and its
  last week has rates; until then `refreshMonthRates` (on load and when rates
  arrive) recomputes it and reconverts the values computed with the old rate.
  A value counts as computed when it equals its own amount converted at that
  rate, so typed amounts are kept. A rate typed for a month
  (`mc-month-rate-set`) wins over the average. D-005's backfill, D-006 and
  imports (D-008) use month rates too.
- **Budget engine** (`server/budget/{base,envelope,tracking}.ts`):
  - `sum-amount-<category>` adds up `COALESCE(mc_budget_amount, amount)`, so
    a budget counts spending in its own currency; transaction changes to
    `mc_budget_amount` recompute it.
  - Per category and month, static cells hold the budget currency's rate to
    the default currency (`mc-todef-<id>`) and the rate from last month's
    budget currency (`mc-carry-<id>`, applied to the carried balance).
    `applyBudgetFactors` sets them from stored month rates;
    `ensureBudgetFactorRates` computes missing rates first.
  - Converted cells (`mc-d-sum-amount-<id>`, `mc-d-budget-<id>`,
    `mc-d-leftover-<id>`) feed group totals, To Budget's income, last
    month's overspending and the automatic hold (`groupInputCell`), which
    therefore stay in the default currency.
  - All of this is only built when multi-currency is on as the spreadsheet is
    built (`setBudgetFactorCellsEnabled`); otherwise the cells are upstream's.
    The multi-currency app service re-applies the rates when preferences,
    budget currencies or categories change (also through sync).
- **Budget actions** (`server/budget/actions.ts`): copying last month's
  budget (all, one category, or until year end) copies currencies;
  averages convert each month's spending into the budget's currency.
- **Handlers** (`server/multi-currency/app.ts`): `mc-budget-set-currency`
  (the budgeted amount and goal convert at the month's rate or keep their
  numbers; the budget's `mc_budget_amount`s are recomputed),
  `mc-month-rates`, `mc-month-rate-set`, `mc-month-rates-refresh`,
  `mc-month-convert`, `mc-default-currency-preview`,
  `mc-default-currency-set`. All changes are undoable.
- **Budget page**:
  - Desktop: the budget menu (`budget/{envelope,tracking}/BudgetMenu.tsx`,
    from `*BudgetComponents.tsx`) gets _Currency: XXX…_, which opens the fork
    `BudgetCurrencyModal` (`mc-budget-currency` in `modals/modalsSlice.ts`
    and `components/Modals.tsx`). Category rows format their amounts in the
    budget's currency (`McBudgetCurrency` in `budget/ExpenseCategory.tsx`
    and `IncomeCategory.tsx`, read once per page by the provider in
    `budget/index.tsx`). Under the month's name
    (`budgetsummary/BudgetSummary.tsx`), `McMonthRates` shows the month's
    rates; clicking one sets a rate for that month.
  - Mobile: the same in `mobile/budget/{BudgetPage,BudgetTable,
ExpenseCategoryListItem,IncomeCategoryListItem}.tsx`; the budget menus
    (`modals/{Envelope,Tracking}BudgetMenuModal.tsx`) get the currency item
    and name the currency next to _Budgeted_.
- **Reports** add up budgets in one currency, the default one, each at its
  month's rate:
  - The budget month handlers (`envelope-budget-month`,
    `tracking-budget-month` in `server/budget/app.ts`) also return each
    category's figures in the default currency, the `mc-d-*` cells
    (`getConvertedMonthCells`). Custom reports (`budgetDataQuery.ts`), the
    spending comparison's budget line (`spending-spreadsheet.ts`), budget
    analysis and formula cards (`useFormulaExecution.ts`) read those (fork
    `reports/mcBudgetCells.ts`), then convert into the report's currency
    (D-015).
  - `api/budget-month` (`server/api.ts`) gives category figures in the
    default currency, like its totals (`getReportCell`); Sankey's budget
    view reads it. API scripts that set budgets still pass amounts in the
    budget's own currency.
- **Changing the default currency** (_Settings → Multi-currency accounts →
  Default currency_; fork `DefaultCurrencySetting`, `DefaultCurrencyModal`;
  server `default-currency.ts`). It only touches what has no currency of its
  own:
  - Budgets without one, from the month of the first transaction (or an
    earlier budget) up to the current month, get the old currency stored on
    them (`mc_currency`; a budget of 0
    is added where a category has none that month), with the same numbers
    and what they counted; or they follow the new default with the same
    numbers. Later changes of the default leave budgets with a currency
    alone, so nothing about dates is stored.
  - Accounts without one get the old currency as their own (every
    transaction gets `mc_amount` with the same number), get another (read
    from workaround notes, else converted at each month's rate), or follow
    with the same numbers. The preview suggests a currency
    from the docs' `#currency:XXX` account note, an "(XXX)" name suffix, or
    workaround notes on at least half of the account's transactions.
  - Every `amount` is worked out again in the new default at its month's
    rate; transfers mirror (the side in the new default decides, then one
    read from a note, then the paying side), split children add up to their
    parent. Budgets set to the old currency keep counting what they counted.
    Money held for next month (`zero_budget_months.buffered`) converts in
    the months up to the current one.
  - Rules written for the docs workaround (a templated `set notes` with
    "FX rate:" plus a templated `set amount`) are deleted when none of their
    accounts stays in the old currency. Rule and schedule amounts are in
    their account's currency (D-018): those whose accounts all get another
    currency convert into it at today's rate; the others keep their
    numbers. The new currency's
    number format and symbol position are set, as upstream's picker does;
    `mcReportCurrency` is cleared when it equals the new default.
  - Refusals (no rate, invalid currency) are `APIError`s shown in the dialog
    (`util/mcErrorMessage.ts`). `global-events.ts` reloads preferences when
    an undo touches them; upstream leaves them stale in Redux.

Not yet: budget templates and goals written in notes don't know about
currencies (a `#template schedule` takes the schedule's amount, in its
account's currency, as is); on narrow phones a budget amount with a long symbol (CA$) can be cut off by
a pixel, an upstream rounding issue in the cells' self-sizing text.

_Reconcile:_ keep while upstream has one currency per budget file. If
upstream adds per-budget currencies, copy `mc_currency` into its field and
drop the factor cells.

### D-018: Rules and schedules in the account's currency

The amounts of rules and schedules are in the currency of the account a
transaction is in: a mortgage of 1.900,00 CA$ paid from a CAD account stays
1.900,00 CA$, whatever the default currency is and whatever the month's
rate. Like every amount a rule holds, they count hundredths. For an account
in the default currency nothing changes. Server helpers live in the fork's
`server/multi-currency/rules.ts`.

- **Running rules** (`runRules` in `transaction-rules.ts`): for a
  transaction in a foreign-currency account that has an account amount,
  rules see that amount as `amount` (`toRulesView`). Afterwards
  (`fromRulesView`) an unchanged amount keeps both stored amounts; a changed
  one becomes the new `mc_amount`, with its default-currency value at the
  month's rate (0 while that rate isn't stored; saving fills it in). Split
  rules divide the account amount, and each part gets both amounts, rounded
  to add up to the parent. This covers imports, bank sync and the rules
  run on a transaction being typed (D-013).
- **Applying actions** (`applyActions`, the rule editor's _Apply actions_):
  actions set the account amount and D-006 derives the default-currency
  value. Split actions applied this way still divide the default-currency
  amount.
- **Filters** (`conditionsToAQL`, used to match schedules, by the rule
  editor's list of transactions, account filters and reports): an amount
  condition compares `amount` for accounts in the default currency and
  `mc_amount` for the others (`toAccountCurrencyAmountFilter`).
- **Schedules**: a posted transaction gets the schedule's amount as
  `mc_amount` (`postTransactionForSchedule` in `schedules/app.ts`; D-006
  derives `amount`). Finding schedules (`find-schedules.ts`) reads account
  amounts. Register previews show the schedule's amount and estimate its
  budget value at today's rate (`estimateBudget` in the shared
  `toAccountCurrencyView`, `useAccountCurrencyRegister`). A schedule made
  from a transaction starts from its account amount (`ScheduleEditModal.tsx`,
  shared `toRulesAmount`). The balance forecast
  (`forecast/forecast-schedules.ts`) adds each occurrence's value in the
  default currency at its month's rate.
- **Display**: the schedule list (`SchedulesTable.tsx`, amount column 100 →
  120 px; mobile `SchedulesListItem.tsx`), the schedule editor (amount
  labelled with the currency, `ScheduleEditForm.tsx`) and rules that name
  one account (`RuleRow.tsx`, `RuleEditor.tsx`, mobile `RulesListItem.tsx`)
  format amounts in the account's currency (fork `McAccountCurrencyFormat`,
  `getRuleAccount`). Lists of a rule's or a schedule's transactions
  (`SimpleTransactionsTable.tsx`) show each in its account's currency
  (`McTransactionAmount`), in an amount column 35 px wider while any account
  has its own currency.
- **Changing the default currency** (D-017): rules whose accounts all get
  another currency convert their amounts into it at today's rate; the
  others keep their numbers.

Not yet:

- Rules and schedules saved before this change for an account that already
  had its own currency held default-currency amounts; they are now read in
  the account's currency, so check them once.
- A rule for several accounts, or for all of them, shows its amounts in the
  default currency, though it compares each transaction in its account's
  currency.
- For currencies without decimals (JPY), amount filters compare hundredths
  with whole yen and miss; running rules is not affected.

_Reconcile:_ keep while upstream rules compare default-currency amounts.
If upstream makes `amount` the account currency, drop the views and the
filter; the schedule changes then become upstream's own behaviour.

### D-009: Docker image

`.github/workflows/fork-docker.yml` builds the same image as upstream's
nightly workflow (`packages/sync-server/docker/ubuntu.Dockerfile`) on every
push to `multicurrency` and publishes
`ghcr.io/jessedyck/actual-server:multicurrency` (plus `sha-…` tags) for
`linux/amd64` and `linux/arm64`. Upstream's own Docker workflows only run on
upstream or on manual dispatch, so they don't interfere.

A `verify` job (typecheck, core tests, web-client tests) gates the build, so
a failing commit never replaces the published image.

### D-011: Client hooks

- `hooks/useMultiCurrency.ts`: whether the feature is on (flag plus budget
  currency, same rule as the server's `getMultiCurrencyContext`), an
  account's currency state, and whether any account has its own currency.
- `hooks/useMultiCurrencyFormat.ts`: formats and parses amounts in any
  currency with the user's number format, symbol position and spacing, using
  that currency's symbol and decimal places. Upstream's `useFormat` only
  knows the default currency.

Both live in `src/hooks/` because desktop-client's `#components/*` import
alias only resolves `.tsx` files; this avoids editing `package.json`.

_Reconcile:_ switch to upstream's formatter once it accepts a currency.

## Syncing with upstream

```bash
git fetch upstream
git switch master && git merge --ff-only upstream/master && git push origin master

# Before merging, look for upstream currency work worth adopting:
git log --oneline -i --grep=currenc master..upstream/master
git diff --stat master@{1} master -- packages/loot-core/migrations

git switch multicurrency && git merge master
# Fork wrappers re-indent a few upstream JSX blocks; if those conflict,
#   git merge --abort && git merge -Xignore-space-change master
# Snapshot conflicts: take upstream's file, then regenerate
#   git checkout --theirs <file>.snap
#   (cd packages/loot-core && ENV=node npx vitest --run -u)
git grep -n "\[fork:mc"            # check each touch point still fits
yarn typecheck && yarn lint && yarn test
git push origin multicurrency      # publishes a new image
```

Update "Last upstream sync" above after each merge.

## Known upstream test quirk

Two tests in `parse-file.test.ts` (`handles windows-1252 charset` and
`csv import accepts iso-8859-1 as a windows-1252 alias`) fail in Node builds
without full ICU, because `€` and `—` aren't decoded. They fail the same way
on unmodified upstream and pass in CI.

**Never regenerate snapshots (`vitest -u`) on such a Node**: it records the
wrongly decoded text. That happened once with
`parse-file.test.ts.snap`, which broke the CI gate; the fix was to restore
upstream's text so the snapshot differs from upstream only by
`"mc_amount": null` lines. Check with
`node -e "new TextDecoder('windows-1252').decode(Buffer.from([0x80]))"`:
it must print `€`.
