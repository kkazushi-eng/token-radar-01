// Token Launch Radar — scoring model.
//
// Everything in this file is a pure transformation: a snapshot goes in,
// a ranked board plus the dashboard's data bundle come out. Nothing here
// touches the filesystem, the network or the clock, which keeps runs
// reproducible byte for byte.
//
// How a protocol earns its implied value
// --------------------------------------
// Only figures that already exist inside the snapshot are used. Protocols
// that do have a token tell us, through their market-cap-to-TVL ratios,
// what the market currently pays for a dollar of TVL in each category.
// A pre-token protocol is then priced as if it launched into that same
// market, with two adjustments: a nudge for its recent TVL momentum and
// a discount that fades the longer it has operated without a token.
//
//   peer ratio   min(mcap / tvl, peer_cap) for every tokenized protocol
//   global price median of all peer ratios
//   category     the category's own median, pulled toward the global
//                median with weight peers / (peers + shrink_k) and
//                clamped into [multiple_floor, multiple_cap]; when a
//                category has no tokenized peers the global median is
//                used instead
//   momentum     1 + clamp(change_7d, ±growth_clamp) / 100 * growth_weight
//   maturity     age_floor + age_range * min(age_days, age_days_cap)
//                / age_days_cap
//   implied      max(1, round(tvl * category * momentum * maturity))
//
// Each factor is rounded to four decimals before the multiplication.
// That rounding is deliberate: the dashboard repeats the same arithmetic
// from the printed factors and must land on the identical dollar amount.
// No name-based special cases exist anywhere in the scoring path.

/** One protocol record, mirroring the ten fields of the sealed snapshot. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Tunable knobs of the model; the dashboard prints these verbatim. */
export interface ModelConstants {
  /** Cap applied to a single peer's mcap/TVL ratio before medians. */
  peer_cap: number;
  /** Shrinkage strength: category medians lean on the global median. */
  shrink_k: number;
  /** Lower and upper bounds for the category multiple actually used. */
  multiple_floor: number;
  multiple_cap: number;
  /** How strongly seven-day TVL momentum moves the valuation. */
  growth_weight: number;
  growth_clamp: number;
  /** Maturity factor endpoints and the horizon over which it ramps. */
  age_floor: number;
  age_range: number;
  age_days_cap: number;
  /** Assumed age when a protocol has no listing date on record. */
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  peer_cap: 3,
  shrink_k: 4,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  growth_weight: 0.4,
  growth_clamp: 50,
  age_floor: 0.7,
  age_range: 0.3,
  age_days_cap: 1095,
  unknown_age_days: 365,
};

/** Version tag shown on the dashboard and quoted in the write-up. */
export const MODEL_VERSION = 'radar-2';

/** Size of the "already trading" side list the dashboard carries. */
export const LIVE_ROWS = 24;

/** Per-category pricing: peer count, raw median, and the applied multiple. */
export interface CategoryMultiple {
  peers: number;
  median: number | null;
  applied: number;
  basis: 'category' | 'shrunk' | 'global';
}

/** All multiples extracted from one snapshot. */
export interface Multiples {
  global_median: number;
  peer_count: number;
  by_category: Map<string | null, CategoryMultiple>;
}

/** A single farm-plan step before it is flattened to a string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A fully scored board row, exactly as written to board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_median: number | null;
    category_peers: number;
    multiple_basis: 'category' | 'shrunk' | 'global';
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** Slim per-row shape embedded in data.js for the dashboard. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_median: number | null;
  category_peers: number;
  multiple_basis: 'category' | 'shrunk' | 'global';
  growth_multiplier: number;
  age_multiplier: number;
}

/** A protocol whose token already trades; shown at market value only. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The complete payload the dashboard renders from. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  peer_count: number;
  universe_size: number;
  pretoken_size: number;
  tokenized_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Raised when the input document is not a snapshot we can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ------------------------------------------------------------------
// Small numeric helpers
// ------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** Round to four decimal places; the unit every printed factor uses. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Keep a value inside [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** `value` when it is a usable number, otherwise `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Middle element (or mean of the middle pair) of a non-empty list. */
function medianOf(values: number[]): number {
  const ordered = values.slice().sort((x, y) => x - y);
  const half = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[half]!;
  return (ordered[half - 1]! + ordered[half]!) / 2;
}

/**
 * Whole days between the day tracking began and the snapshot date.
 * Returns null when either side is missing or unparseable, and never
 * goes negative for a listing dated after the snapshot.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(asOf + 'T00:00:00Z');
  const start = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.floor((end - start) / MS_PER_DAY);
  return days < 0 ? 0 : days;
}

// ------------------------------------------------------------------
// Pricing: multiples read out of the snapshot itself
// ------------------------------------------------------------------

/**
 * Collect every tokenized protocol's capped mcap/TVL ratio, then derive
 * one global median plus a shrunk, clamped median per category.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const ratiosByCategory = new Map<string | null, number[]>();
  const everyRatio: number[] = [];

  for (const proto of snapshot.protocols) {
    if (proto.mcap_usd === null || proto.mcap_usd <= 0 || proto.tvl_usd <= 0) continue;
    const ratio = Math.min(proto.mcap_usd / proto.tvl_usd, model.peer_cap);
    everyRatio.push(ratio);
    const bucket = ratiosByCategory.get(proto.category);
    if (bucket) bucket.push(ratio);
    else ratiosByCategory.set(proto.category, [ratio]);
  }

  const globalMedian = everyRatio.length > 0 ? medianOf(everyRatio) : 1;

  const byCategory = new Map<string | null, CategoryMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const rawMedian = medianOf(ratios);
    const blended =
      (ratios.length * rawMedian + model.shrink_k * globalMedian) /
      (ratios.length + model.shrink_k);
    byCategory.set(category, {
      peers: ratios.length,
      median: round4(rawMedian),
      applied: round4(clamp(blended, model.multiple_floor, model.multiple_cap)),
      basis: ratios.length >= model.shrink_k ? 'category' : 'shrunk',
    });
  }

  return { global_median: round4(globalMedian), peer_count: everyRatio.length, by_category: byCategory };
}

/** The pricing entry for one protocol, falling back to the global median. */
function multipleFor(proto: SnapshotProtocol, multiples: Multiples): CategoryMultiple {
  const own = multiples.by_category.get(proto.category);
  if (own) return own;
  return { peers: 0, median: null, applied: multiples.global_median, basis: 'global' };
}

/** Score a single protocol and expose every factor that went into it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  model: ModelConstants = MODEL,
): { implied: number; multiple: CategoryMultiple; growthPct: number; growthMult: number; ageMult: number; age: number | null } {
  const multiple = multipleFor(protocol, multiples);
  const age = ageDays(asOf, protocol.listed_at);

  const growthPct = clamp(numOr(protocol.change_7d, 0), -model.growth_clamp, model.growth_clamp);
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);

  const effectiveAge = clamp(age ?? model.unknown_age_days, 0, model.age_days_cap);
  const ageMult = round4(model.age_floor + (effectiveAge / model.age_days_cap) * model.age_range);

  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple.applied * growthMult * ageMult));
  return { implied, multiple, growthPct, growthMult, ageMult, age };
}

// ------------------------------------------------------------------
// Who gets ranked
// ------------------------------------------------------------------
//
// The watchlist is a floor: every slug on it is ranked. Below the floor
// the board casts wider, but it reuses the watchlist's own product
// rules so the extra rows are the same kind of thing — genuine first
// launches, not wrappers, staking receipts, exchange house products or
// later versions of protocols that already have a token.

/** Names ending in a version tag belong to another protocol's pool. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked derivative product. */
const DERIVATIVE_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange brand prefixes: house products, not independent launches. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories excluded by the same product rules. */
const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** True when the record shows no token: no cap, no Gecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when a pre-token protocol is the kind of product the board ranks. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (DERIVATIVE_WORD.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

// ------------------------------------------------------------------
// Board construction
// ------------------------------------------------------------------

/**
 * Build the ranked board: all watchlist protocols, plus every rankable
 * pre-token protocol under the TVL floor, sorted by implied value with
 * slug order as the tie-break, ranks numbered from 1.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const watchlistSlugs = new Set(snapshot.watchlist);

  const picked = new Map<string, SnapshotProtocol>();
  const lookup = new Map(snapshot.protocols.map((p) => [p.slug, p] as const));
  for (const slug of snapshot.watchlist) {
    const proto = lookup.get(slug);
    if (proto) picked.set(slug, proto);
  }
  for (const proto of snapshot.protocols) {
    if (picked.has(proto.slug)) continue;
    if (proto.tvl_usd < snapshot.floor_usd && isRankable(proto)) {
      picked.set(proto.slug, proto);
    }
  }

  const scored = Array.from(picked.values(), (p) => {
    const result = impliedValue(p, snapshot.as_of, multiples, model);
    return { proto: p, ...result };
  });
  scored.sort((a, b) => {
    if (b.implied !== a.implied) return b.implied - a.implied;
    if (a.proto.slug < b.proto.slug) return -1;
    if (a.proto.slug > b.proto.slug) return 1;
    return 0;
  });

  return scored.map((entry, index) => {
    const p = entry.proto;
    return {
      rank: index + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: entry.age,
      watchlist: watchlistSlugs.has(p.slug),
      implied_value_usd: entry.implied,
      model: {
        category_multiple: entry.multiple.applied,
        category_median: entry.multiple.median,
        category_peers: entry.multiple.peers,
        multiple_basis: entry.multiple.basis,
        growth_pct: entry.growthPct,
        growth_multiplier: entry.growthMult,
        age_multiplier: entry.ageMult,
        age_days: entry.age,
      },
      farm_steps: farmSteps(p, entry.age).map(stepText),
    };
  });
}

/**
 * Flatten a step into the single string board.json carries, keeping it
 * inside the gate's 20–600 character window.
 */
export function stepText(step: FarmStep): string {
  let text = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (text.length > 600) text = text.slice(0, 596) + '...';
  if (text.length < 20) text += " Hold the position and check the protocol's own page.";
  return text;
}

// ------------------------------------------------------------------
// Farm plans
// ------------------------------------------------------------------
//
// A plan is assembled from the protocol's own record only: its first
// chain decides the fee wording, its TVL decides a sensible position
// size, its age decides the hold, and its category decides the three
// middle actions. The fixed frame (fresh wallet, funding route, weekly
// cadence, hold, logbook) is shared by every row.

/** The chain a plan starts on: the first one the record lists. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

type ChainKind = 'mainnet' | 'layer2' | 'solana' | 'bitcoin' | 'other';

const LAYER2_CHAINS: ReadonlySet<string> = new Set([
  'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle',
  'Blast', 'Mode', 'Ink', 'Unichain', 'Taiko', 'World Chain', 'Soneium', 'Zora',
]);

function classifyChain(chain: string): ChainKind {
  if (chain === 'Ethereum') return 'mainnet';
  if (chain === 'Solana') return 'solana';
  if (chain === 'Bitcoin') return 'bitcoin';
  return LAYER2_CHAINS.has(chain) ? 'layer2' : 'other';
}

/** Fee wording for a chain kind, in the bands a farmer budgets with. */
function gasWording(kind: ChainKind): string {
  const table: Record<ChainKind, string> = {
    mainnet: 'about $8 to $15 of gas per transaction on Ethereum, less off-peak',
    layer2: 'under $1 of gas per transaction on this layer-2 chain',
    solana: 'under $1 of fees per transaction on Solana',
    bitcoin: 'about $1 to $3 of network fees per transaction on Bitcoin',
    other: 'about $1 to $3 of gas per transaction on this chain',
  };
  return table[kind];
}

/** Working capital for one position, scaled to the protocol's TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Hold length in days; younger protocols qualify over a longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The three category-specific actions inside every plan. */
interface CategoryActions {
  core: string;
  second: string;
  weekly: string;
}

/**
 * Pick the actions for a protocol by matching keywords in its category.
 * The checks run in a fixed order and the first match wins; anything
 * unmatched falls through to a generic deposit plan.
 */
function categoryActions(p: SnapshotProtocol, capital: number, chain: string): CategoryActions {
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  const mentions = (...words: string[]): boolean => words.some((w) => cat.includes(w));

  if (mentions('curator', 'allocator', 'collateral market', 'liquidity manager')) {
    return {
      core: `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain}; the vault shares are the position to hold.`,
      second: `After a week, add a second smaller deposit, about half the first, so the position is built over time rather than placed on one day.`,
      weekly: `Check the vault's allocation once a week; the curator rebalances for you, so act only if the vault's strategy or chain changes.`,
    };
  }
  if (mentions('lend', 'cdp', 'uncollateralized')) {
    return {
      core: `Supply $${capital} of USDC to ${name} on ${chain}; supplied balances are what lending programs measure.`,
      second: `Borrow a small amount against the supply, no more than a third of it, and keep the health factor well clear of liquidation; an open borrow is a second activity signal.`,
      weekly: `Repay part of the borrow and borrow again, or top the supply up, once a week so the account shows regular use.`,
    };
  }
  if (mentions('dex')) {
    return {
      core: `Swap about $${capital} through ${name}'s main pool on ${chain}, then provide the proceeds as two-sided liquidity in that pool.`,
      second: `Leave the liquidity in place for the whole hold period; withdrawing and re-adding resets the age of the position.`,
      weekly: `Make one swap of at least $25 through the exchange each week, so the wallet's volume is spread across many days.`,
    };
  }
  if (mentions('derivative', 'perpetual', 'option')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged pair, a long and a short of similar size, so the price does not decide the outcome.`,
      second: `Close the pair after a few days and open a fresh one, so the account records completed trades and fees paid, not one open ticket.`,
      weekly: `Trade a small hedged volume every week; derivatives programs count real, spread-out volume and fees, not one large trade.`,
    };
  }
  if (mentions('bridge')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} through ${name} and use the funds in an app on the far side the same day.`,
      second: `A few days later, bridge a smaller amount back, or onward to a second chain ${name} serves, so both directions are on record.`,
      weekly: `Make one bridge trip a week in either direction, keep each trip small, and keep every bridge receipt.`,
    };
  }
  if (mentions('restak', 'staking')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`,
      second: `Where ${name} offers delegation or restaking of the receipt, switch it on once and leave the delegation active.`,
      weekly: `Claim or restake any rewards once a week, so the position compounds and the wallet stays active.`,
    };
  }
  if (mentions('yield', 'leveraged farm') || cat === 'farm') {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s main vault or pool on ${chain} and hold the vault shares it issues.`,
      second: `Compound the first yield payment back into the same vault instead of withdrawing it.`,
      weekly: `Check the position once a week and top it up with a small deposit, about $10, so the balance keeps growing.`,
    };
  }
  if (mentions('basis')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s basis-trading vault on ${chain}; the vault runs the hedge, and your shares are the position.`,
      second: `Do not trade around the vault; basis vaults reward time-weighted balances, so a still position scores better than a busy one.`,
      weekly: `Check the vault's reported balance once a week and add a small top-up, about $10, if it has not grown.`,
    };
  }
  if (mentions('stable', 'dual-token')) {
    return {
      core: `Mint or deposit $${capital} through ${name} on ${chain} to hold its stable asset, and keep the stablecoins in the farming wallet.`,
      second: `Put about half of the minted stablecoins to work in a pool or vault ${name} itself offers, if it offers one, and hold the rest.`,
      weekly: `Mint or deposit a small top-up, about $10, once a week so the balance grows steadily.`,
    };
  }
  if (mentions('rwa')) {
    return {
      core: `Buy or mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it in the farming wallet.`,
      second: `Hold through at least one full month without trading; real-world-asset positions are counted by holding period, not by activity.`,
      weekly: `Check the position's reported value once a week; no trade is needed, and frequent trading only adds cost.`,
    };
  }
  if (mentions('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy active.`,
      second: `When the first cover period ends, renew it once so the policy history is continuous.`,
      weekly: `Check the cover is still active once a week; the renewal date is the only deadline that matters.`,
    };
  }
  if (mentions('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and take one position in a market you have a view on.`,
      second: `When the market resolves, settle it and roll the proceeds into the next market in the same week.`,
      weekly: `Keep one open position at all times; a continuous record counts for more than trade size.`,
    };
  }
  if (mentions('payment')) {
    return {
      core: `Route one real payment of about $${capital} through ${name} and keep the receipt; payment products count repeat users, not one-off tests.`,
      second: `Make a second payment in a different week, to a different recipient if you can.`,
      weekly: `Use ${name} for one payment a week, however small, so the account shows a habit.`,
    };
  }
  if (mentions('chain')) {
    return {
      core: `Bridge $${capital} onto ${chain}, the chain ${name} tracks, and hold it in the farming wallet; a funded wallet on a young chain is the position.`,
      second: `Use one app native to the chain, a swap or a deposit, so the wallet has real on-chain activity, and keep a small gas balance behind.`,
      weekly: `Make one small transaction on the chain each week; chain campaigns count weekly active wallets.`,
    };
  }
  if (mentions('privacy')) {
    return {
      core: `Deposit $${capital} into ${name}'s pool on ${chain} and make one transfer between two wallets you control.`,
      second: `Leave the balance in the pool for the whole hold period; privacy pools count balances that stay.`,
      weekly: `Check the balance once a week; no further transfer is needed.`,
    };
  }
  if (mentions('cedefi')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s earn product on ${chain} and hold the position it issues.`,
      second: `After the first week, add a second deposit about half the size of the first.`,
      weekly: `Check the position once a week and claim any credited yield back into the same product.`,
    };
  }
  if (mentions('governance')) {
    return {
      core: `Deposit $${capital} into the incentive program ${name} runs on ${chain}, in the asset the program measures.`,
      second: `If the program offers a vote or a gauge, cast one; governance activity is a second, cheap signal.`,
      weekly: `Check the program balance once a week and top it up if it has fallen.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `After a week, add a second smaller deposit, about half the first, so the position is built over time.`,
    weekly: `Make one small qualifying action each week, a deposit, a claim or a vote, so the wallet stays active.`,
  };
}

/**
 * Assemble the seven-step plan for one protocol: wallet setup, funding
 * route, the category's three actions, the hold, and the logbook step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasWording(classifyChain(chain));
  const actions = categoryActions(p, capital, chain);

  const funding =
    p.chains.length > 1
      ? `${p.name} runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}); start on ${chain}, the first it lists, and bridge the funds there if they start somewhere else.`
      : `${p.name} runs on ${chain}; move the funds there directly from an exchange or another wallet.`;

  const steps: FarmStep[] = [];
  steps.push({
    text: `Set up a fresh wallet for this farm and write its seed phrase on paper, offline; never farm from a wallet that holds your main funds.`,
    cost: 'no fee; the wallet software is free',
    time: '10 minutes',
  });
  steps.push({
    text: funding,
    cost: gas,
    time: '15 minutes, or up to an hour when a bridge is involved',
  });
  steps.push({ text: actions.core, cost: `$${capital} of working capital, plus ${gas}`, time: '15 minutes to set up' });
  steps.push({ text: actions.second, cost: 'a smaller follow-up amount and one more transaction fee', time: '10 minutes' });
  steps.push({ text: actions.weekly, cost: gas, time: '10 minutes a week' });
  steps.push({
    text: `Hold the position for at least ${hold} days without withdrawing; eligibility snapshots reward wallets that stay in, and an early exit wastes the fees already spent.`,
    cost: `the $${capital} stays in the position for the whole hold`,
    time: `${hold} days`,
  });
  steps.push({
    text: `Keep a farm log (wallet, chain, dates, amounts, transaction hashes) and check ${p.name}'s own announcements before claiming anything; never pay a fee to claim a reward.`,
    cost: 'nothing to log; claiming, if it ever opens, should be free',
    time: '5 minutes a week',
  });
  return steps;
}

// ------------------------------------------------------------------
// Dashboard payload
// ------------------------------------------------------------------

/** The largest already-trading protocols, for the dashboard's live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => {
    const byCap = (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0);
    return byCap !== 0 ? byCap : b.tvl_usd - a.tvl_usd;
  });
  return trading.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** Convert a board row into the compact shape data.js embeds. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_median: row.model.category_median,
    category_peers: row.model.category_peers,
    multiple_basis: row.model.multiple_basis,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
  };
}

/** Build both outputs of the model: the board and the dashboard data. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);

  const preTokenCount = snapshot.protocols.filter(isPreToken).length;
  const earlyCount = board.reduce((n, r) => (r.watchlist ? n : n + 1), 0);

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global_median,
    peer_count: multiples.peer_count,
    universe_size: snapshot.protocols.length,
    pretoken_size: preTokenCount,
    tokenized_size: snapshot.protocols.length - preTokenCount,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ------------------------------------------------------------------
// Input parsing and board validation
// ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse and validate snapshot JSON. The shape is checked field by field
 * and anything unexpected degrades to null/empty rather than slipping
 * through, except for the structural fields the model cannot run
 * without — those raise SnapshotError with a specific message.
 */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (!isRecord(parsed)) throw new SnapshotError('snapshot.json is not a JSON object');

  const doc = parsed;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }

  const protocols: SnapshotProtocol[] = doc.protocols.map((entry, index) => {
    if (!isRecord(entry)) throw new SnapshotError(`snapshot.json's protocol ${index} is not an object`);
    if (typeof entry.slug !== 'string' || typeof entry.name !== 'string' || typeof entry.tvl_usd !== 'number' || !Number.isFinite(entry.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${index} lacks a slug, a name or a TVL`);
    }
    const chains = Array.isArray(entry.chains)
      ? entry.chains.filter((c): c is string => typeof c === 'string')
      : [];
    return {
      slug: entry.slug,
      name: entry.name,
      category: stringOrNull(entry.category),
      chains,
      tvl_usd: entry.tvl_usd,
      change_7d: numberOrNull(entry.change_7d),
      mcap_usd: numberOrNull(entry.mcap_usd),
      listed_at: stringOrNull(entry.listed_at),
      gecko_id: stringOrNull(entry.gecko_id),
      symbol: stringOrNull(entry.symbol),
    };
  });

  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    // Copy the list: the snapshot owns its watchlist, the parsed JSON
    // document stays the caller's to mutate.
    watchlist: [...(doc.watchlist as string[])],
  };
}

/**
 * Pre-flight check mirroring the gate's board rules. Returns a human
 * readable reason when the board would be refused, or null when it is
 * fit to write out.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const present = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((slug) => !present.has(slug));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  if (board.length < 100) return `the board holds ${board.length} rows: the gate takes 100 to 4,000`;

  const rankList = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < rankList.length; i++) {
    if (rankList[i] !== i + 1) return `rank ${i + 1} is ${rankList[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has a farm step of ${len} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
  }
  return null;
}

/** Serialize the dashboard payload as the data.js script body. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
