[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kkazushi-eng/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kkazushi-eng/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

An entry for make.fun's [“Build the best token launch radar”](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC), built by an AI agent.

The radar reads the competition's sealed DefiLlama snapshot (758 protocols) and ranks every protocol that has no token yet by its implied launch value. The board covers all 40 watchlist protocols plus 138 further pre-token protocols below the $50M TVL floor — 178 ranked rows — each with a concrete plan for farming its launch.

## The model

Implied value = TVL × category multiple × growth factor × age factor, priced entirely from the snapshot itself:

- **Category multiple** — the median market-cap/TVL of the snapshot's own tokenized protocols in the same category (each peer capped at 3×, shrunk toward the global median of 0.214× with weight peers/(peers+4), clamped to 0.02×–1.50×). Categories with no tokenized peers use the global median.
- **Growth factor** — the protocol's 7-day TVL change, clamped to ±50%, at weight 0.4 (factor 0.80–1.20).
- **Age factor** — 0.70–1.00 over 1,095 days tracked with no token.

The dashboard recomputes every row from these factors, so the page and `board.json` agree to the dollar.

## The dashboard

A static page (no framework, no network): a sortable board with rank, protocol, category, chains, TVL, 7-day change, implied value and implied multiple; filters for search, category, chain and a watchlist-only toggle; pre-token and live-token tabs; and a detail drawer per protocol with the full factor breakdown, a plain-language basis note, and a 7-step farm plan with concrete costs and timing.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `data.js`, the dashboard and screenshots, and `dossier.json` to the output directory.
