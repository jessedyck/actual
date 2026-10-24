# Actual Budget with multi-currency accounts

> [!WARNING]
> **AI-built and for personal use only. Please don't use it.**
>
> This fork was written by an AI coding assistant (Claude, by Anthropic) at
> its owner's request, for the owner's own budget. Actual's maintainers have
> not reviewed it, nothing here is supported, and it can damage budget data.
> It is not a proposal for upstream: please don't open issues or pull
> requests about it on
> [actualbudget/actual](https://github.com/actualbudget/actual).
>
> If you want multi-currency in Actual, follow the official work instead:
> [currency feedback issue #5191](https://github.com/actualbudget/actual/issues/5191).

A personal fork of [Actual Budget](https://github.com/actualbudget/actual)
that adds accounts and budgets in other currencies. A budget file has a
default currency; each account, and each category's budget in each month,
can have its own. Amounts are converted at each month's average of the daily
rates from [Frankfurter](https://frankfurter.dev) (free, no key) or rates
you enter.

Every difference from upstream is logged in [DEVIATIONS.md](DEVIATIONS.md) so
the fork can switch to upstream's own implementation as it lands.

## Status

| Piece                                                                           | State   |
| ------------------------------------------------------------------------------- | ------- |
| Account currency, account-currency amounts, rate cache (database)               | Done    |
| Automatic and manual exchange rates                                             | Done    |
| Conversion on every save, transfers between currencies, splits                  | Done    |
| Starting balance and backfill when an account gets a currency                   | Done    |
| Settings: turning it on, exchange rates, default-currency lock                  | Done    |
| Accounts: currency when creating or changing, balances in that currency         | Done    |
| Register (desktop): entering and showing amounts in the account's currency      | Done    |
| Reconcile in the account's currency (desktop)                                   | Done    |
| Imports (CSV, OFX, QIF, CAMT) in the account's currency                         | Done    |
| Mobile: amounts and reconcile in the account's currency                         | Done    |
| Exchange rate adjustment to today's value (desktop)                             | Done    |
| Net worth report: accounts valued at each period's rate, shown in any currency  | Done    |
| Cash flow report (page and card) in any currency                                | Done    |
| Custom and spending reports (pages and cards) in any currency                   | Done    |
| Summary, budget analysis and calendar cards, one picker for the whole dashboard | Done    |
| A currency on each budget (per category and month), month rates                 | Done    |
| Changing the default currency (for example CAD to EUR), keeping past budgets    | Done    |
| Rules and schedules in the account's currency                                   | Done    |
| Account currency in the account's note (`#currency:XXX`)                        | Done    |
| Server and app versions with the commit they were built from                    | Done    |
| Other reports (budget analysis, Sankey, crossover…) in another currency         | Planned |

## Log

What was done, newest first. All of it was implemented by an AI assistant;
[DEVIATIONS.md](DEVIATIONS.md) has the details of every change.

- **2026-10-24** · The server shows the same version as the app, both
  with the commit they were built from (for example `v26.10.0+abc1234`), and
  Settings says when they differ. An account can be set to the default
  currency itself, without changing any amount, so a later change of the
  default leaves it alone; new accounts keep the currency they're created
  in. An account's currency is also written in its note as
  `#currency:XXX`, the format Actual's docs use.
- **2026-10-20** · Reports that show budgets add them up in one currency,
  each at its month's rate, so CAD and EUR budgets in the same month no
  longer mix; budget analysis gets the currency picker (page and dashboard
  card). Changing the default currency sets budgets from the month of the
  first transaction.
  [f9ccd74](https://github.com/jessedyck/actual/commit/f9ccd74)
- **2026-10-19** · Review round 3: changing the default currency now
  stores the old currency on each past budget and on the accounts without
  one, with the same numbers, instead of a rule about dates (a rule stored
  by the earlier version is moved onto the budgets when a budget file
  opens); clearer wording there and in the account currency dialog.
  [cf61eb0](https://github.com/jessedyck/actual/commit/cf61eb0)
- **2026-10-19** · Rules and schedules count amounts in the account's
  currency: a 1.900,00 CA$ mortgage schedule on a CAD account keeps posting
  1.900,00 CA$ after the default currency changes, and rules compare, set
  and split that amount. Schedules, rules and their transaction lists show
  amounts in that currency; the balance forecast converts them at each
  month's rate. [4311bdd](https://github.com/jessedyck/actual/commit/4311bdd)
- **2026-10-19** · Changing an account's currency can convert its amounts
  or keep their numbers (for an account set up in the wrong currency), and
  shows the current currency; the mobile account list can show its totals
  in another currency at today's rate; the mobile reconcile prompt names
  the currency; the reports dashboard has one currency picker, and summary
  and calendar cards follow it too.
  [e99d04c](https://github.com/jessedyck/actual/commit/e99d04c)
- **2026-10-16** · A currency on each budget: each category's budget in
  each month can be in its own currency (budget menu → _Currency_), and
  counts spending in it at the month's average rate; group totals and To
  Budget stay in the default currency. The rate each month uses is shown
  under its name and can be changed. _Change default currency_ replaces
  _Change budget currency_: budgets and accounts without a currency of their
  own can keep the old one, so past months show what they showed. Wording:
  "default currency" and "budget file".
  [3c73885](https://github.com/jessedyck/actual/commit/3c73885)
- **2026-10-15** · Review round 2: All accounts (and other views of several
  accounts) shows each transaction in its own account's currency with the
  currency symbol; an info button on a foreign account explains "Worth
  today" and "In budget"; clearer wording in the multi-currency settings.
  [7be3a7e](https://github.com/jessedyck/actual/commit/7be3a7e)
- **2026-10-15** · Fixes found while reviewing screenshots: the stored
  exchange rates list no longer squashes its rows when it holds many rates,
  and the currency change's result counts a split once, like its preview.
  [a35e3e0](https://github.com/jessedyck/actual/commit/a35e3e0)
- **2026-10-15** · Change budget currency: moves the whole budget, history
  included, to another currency. Each transaction is converted at its own
  date's rate, each month's budget at that month's rates; accounts can keep
  their currency, and accounts recorded with the rule-template workaround
  take their amounts from the notes.
  [1c4bfa7](https://github.com/jessedyck/actual/commit/1c4bfa7)
- **2026-10-14** · Custom reports and the spending comparison (pages and
  dashboard cards) in any currency, each period at its own rate.
  [aef4b22](https://github.com/jessedyck/actual/commit/aef4b22)
- **2026-10-14** · Cash flow report (page and dashboard card) in any
  currency, each day or month at its own rate.
  [ad24fc3](https://github.com/jessedyck/actual/commit/ad24fc3)
- **2026-10-14** · Net worth report: accounts in other currencies are
  valued at the rate of each period, and the report (page and dashboard
  card) can be shown in any currency.
  [546ca7b](https://github.com/jessedyck/actual/commit/546ca7b)
- **2026-10-14** · Exchange rate adjustment: one click records the
  difference between what an account in another currency is worth today and
  its value in the budget.
  [57a5e2b](https://github.com/jessedyck/actual/commit/57a5e2b)
- **2026-10-14** · Mobile: an account with its own currency shows its
  balances, transactions and running balances in that currency; amounts are
  entered in the currency of the chosen account; reconciling works in that
  currency. [7ee0afb](https://github.com/jessedyck/actual/commit/7ee0afb)
- **2026-10-14** · Importing files into an account with its own currency:
  amounts are read in that currency, converted at each transaction's date,
  and matched against existing transactions in that currency.
  [ba7e827](https://github.com/jessedyck/actual/commit/ba7e827)
- **2026-10-14** · Register: accounts in currencies without decimals (yen,
  won) store what is typed, and scheduled transactions continue the running
  balance in the account's currency.
  [a097733](https://github.com/jessedyck/actual/commit/a097733)
- **2026-10-14** · Reconcile in the account's currency (desktop): the
  statement balance is typed in that currency and the adjustment transaction
  is stored in it. [ea38712](https://github.com/jessedyck/actual/commit/ea38712)
- **2026-10-14** · README: notice that the fork is AI-built and for personal
  use only, and this log.
  [021e2ff](https://github.com/jessedyck/actual/commit/021e2ff)
- **2026-10-14** · Register in the account's currency (desktop): amounts,
  splits and running balance in the account's currency, budget amount in the
  tooltip.
  [8a4a59f](https://github.com/jessedyck/actual/commit/8a4a59f)
- **2026-10-14** · Fixed a test snapshot recorded on a Node build without full
  ICU, which had blocked the image build.
  [add2742](https://github.com/jessedyck/actual/commit/add2742)
- **2026-10-14** · Accounts: pick a currency when creating one, change it
  later (existing transactions are converted), balances in the account's
  currency with "worth today" and "in budget".
  [926f99a](https://github.com/jessedyck/actual/commit/926f99a)
- **2026-10-14** · Settings: turning the feature on, automatic rate downloads,
  the rate service, manual rates, converting pending transactions; the budget
  currency is locked while accounts use other currencies.
  [160086b](https://github.com/jessedyck/actual/commit/160086b)
- **2026-10-14** · The Docker image is only published after typecheck and
  tests pass. [e820747](https://github.com/jessedyck/actual/commit/e820747)
- **2026-10-14** · Docker image built on every push:
  `ghcr.io/jessedyck/actual-server:multicurrency`.
  [3f3d811](https://github.com/jessedyck/actual/commit/3f3d811)
- **2026-10-14** · Server side: account currency and account-currency amounts
  in the database, exchange rates (Frankfurter and manual), conversion on
  every save, transfers between currencies, splits, converting existing
  accounts. [b536b3f](https://github.com/jessedyck/actual/commit/b536b3f)
- **2026-10-14** · Fork created from upstream `master` at `832f43da`
  (26.10.0), with this README and the deviation log.
  [ac46416](https://github.com/jessedyck/actual/commit/ac46416)

## Running it

The image is built by GitHub Actions on every push to `multicurrency`. Copy
[docker-compose.yml](docker-compose.yml) to a folder on your server and run
`docker compose up -d`, or change an existing setup's image from
`actualbudget/actual-server` to
`ghcr.io/jessedyck/actual-server:multicurrency`. Your data folder works with
both images. Back it up before switching anyway: this is experimental code.

The first time the workflow publishes, GitHub makes the package private. To
pull without logging in, open the package's settings on GitHub
(_Packages → actual-server → Package settings_) and make it public, or run
`docker login ghcr.io` with a personal access token.

To build the image yourself instead:

```bash
docker build -f sync-server.Dockerfile -t actual-server:multicurrency .
```

## Turning it on

1. _Settings → Show advanced settings → Experimental features_: enable
   **Currency support** and **Multi-currency accounts**.
2. _Settings → Currency_: choose your default currency (for example CAD).
3. Create an account and pick its currency.
4. To budget a category in another currency for a month, open its budget
   menu on the budget page and choose _Currency_.
5. To make another currency the default (for example after moving), use
   _Settings → Multi-currency accounts → Change default currency_.

## How amounts are stored

Every transaction keeps `amount` in the default currency, exactly like
upstream, so balances, To Budget and reports are unaffected. Accounts in
another currency also store the amount in their own currency, and a
transaction counted in a budget with its own currency stores its value in
that currency. Editing an account-currency amount converts it again at its
month's rate; editing the default-currency amount directly records what your
bank actually charged.

## Using official Actual on the same budget

An official Actual client of the **same or an older version** than the fork's
upstream base can open and sync the budget: it ignores the fork's data. Avoid
editing foreign-currency transactions there, because it can't keep both
amounts in step.

An official client that is **newer** than the fork's upstream base (for
example an auto-updated desktop app) can refuse to open the budget with an
`out-of-sync-migrations` error: the file contains the fork's migration but is
missing the newer official one. Use the fork's web app on every device.

### Going back to official Actual

The fork only adds to the database, so official Actual can take over a budget
the fork has used, as long as the fork build you last ran was based on the
same or a newer upstream version:

1. Sync the fork with upstream up to (at least) the official version you want
   to run, let the image rebuild, and open the budget with it once.
2. Switch the image back to `actualbudget/actual-server`.

Official Actual then shows default-currency amounts everywhere and leaves the
fork's extra data untouched, so switching back to the fork later still works.

## GitHub Actions in the fork

Only `Fork Docker image` matters for this fork. It checks types and runs the
tests before it builds and publishes, so a broken commit never becomes the
`multicurrency` image. The other workflows come from upstream and target its
infrastructure: they skip themselves, fail, or wait forever for a runner when
`master` is synced. To silence them, open the fork's _Actions_ tab, pick each
workflow, then _… → Disable workflow_.

## Updating from upstream

See _Syncing with upstream_ in [DEVIATIONS.md](DEVIATIONS.md).
