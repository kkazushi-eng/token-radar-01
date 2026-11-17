// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// other pre-token protocol below the floor that could plausibly issue a first token of its own: the
// early rows the radar exists to find. Below the floor the board applies the watchlist's own product
// rules, so exchanges, versioned pools and wrapped, staked or bridged products of tokens that already
// trade are set aside, exactly as the watchlist sets them aside. A protocol is pre-token when its
// record carries no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token
// protocols are kept apart and shown at the market's own values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures. The snapshot's tokenized protocols are
// the market's own answer to "what is a protocol worth against its TVL", so the model reads it:
//
//   peers       = the tokenized protocols (a market cap and a TVL on record)
//   multiple(p) = mcap_usd / tvl_usd, each one capped at PEER_CAP before any median is taken
//   global      = the median multiple over all peers
//   category    = a category's own median multiple, shrunk toward the global median with weight
//                 peers / (peers + SHRINK_K), then clamped to [MULTIPLE_FLOOR, MULTIPLE_CAP];
//                 a category with no tokenized peers uses the global median
//   growth      = 1 + clamp(change_7d, -GROWTH_CLAMP, GROWTH_CLAMP) / 100 x GROWTH_WEIGHT
//   age         = AGE_FLOOR + AGE_RANGE x min(age_days, AGE_DAYS_CAP) / AGE_DAYS_CAP
//   implied     = max(1, round(tvl_usd x category x growth x age))
//
// The three factors are rounded to 4 decimal places before they are multiplied, so the dashboard
// recomputes every row's implied value from the figures it prints and lands on the same dollar.
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** One peer's mcap/TVL multiple is capped at this before any median is taken. */
  peer_cap: number;
  /** A category median is shrunk toward the global median with weight peers / (peers + shrink_k). */
  shrink_k: number;
  /** The applied category multiple is clamped into this band. */
  multiple_floor: number;
  multiple_cap: number;
  /** Seven-day growth moves the value by this weight of the clamped change. */
  growth_weight: number;
  growth_clamp: number;
  /** The age factor runs from age_floor to age_floor + age_range over age_days_cap days. */
  age_floor: number;
  age_range: number;
  age_days_cap: number;
  /** The age a protocol with no listed_at is scored at. */
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

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's multiple: its tokenized peers, their median, and the multiple the model applies. */
export interface CategoryMultiple {
  peers: number;
  median: number | null;
  applied: number;
  basis: 'category' | 'shrunk' | 'global';
}

/** The multiples read off the snapshot: the global median and one entry per category. */
export interface Multiples {
  global_median: number;
  peer_count: number;
  by_category: Map<string | null, CategoryMultiple>;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The multiples the snapshot itself carries: every tokenized protocol's market cap against its TVL,
 * each capped at the model's peer cap, read as one global median and one shrunk median per category.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Multiples {
  const peersByCategory = new Map<string | null, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const multiple = Math.min(p.mcap_usd / p.tvl_usd, model.peer_cap);
    all.push(multiple);
    const list = peersByCategory.get(p.category) ?? [];
    list.push(multiple);
    peersByCategory.set(p.category, list);
  }
  const globalMedian = all.length > 0 ? median(all) : 1;
  const byCategory = new Map<string | null, CategoryMultiple>();
  for (const [category, values] of peersByCategory) {
    const med = median(values);
    const shrunk = (values.length * med + model.shrink_k * globalMedian) / (values.length + model.shrink_k);
    byCategory.set(category, {
      peers: values.length,
      median: round4(med),
      applied: round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk))),
      basis: values.length >= model.shrink_k ? 'category' : 'shrunk',
    });
  }
  return { global_median: round4(globalMedian), peer_count: all.length, by_category: byCategory };
}

/** The multiple one protocol is scored at: its category's, or the global median when it has no peers. */
function multipleFor(p: SnapshotProtocol, multiples: Multiples, model: ModelConstants): CategoryMultiple {
  return multiples.by_category.get(p.category) ?? { peers: 0, median: null, applied: multiples.global_median, basis: 'global' };
}

/** The model's full scoring of one protocol: the implied value and every factor that made it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  model: ModelConstants = MODEL,
): { implied: number; multiple: CategoryMultiple; growthPct: number; growthMult: number; ageMult: number; age: number | null } {
  const multiple = multipleFor(protocol, multiples, model);
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_clamp, Math.max(-model.growth_clamp, finite(protocol.change_7d, 0)));
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const ageMult = round4(model.age_floor + (Math.min(Math.max(ageForModel, 0), model.age_days_cap) / model.age_days_cap) * model.age_range);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple.applied * growthMult * ageMult));
  return { implied, multiple, growthPct, growthMult, ageMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The exchanges the watchlist rule names: a name that begins with one is the exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories the watchlist rule sets aside: products of tokens that already trade, and exchanges. */
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol below the floor is one the board may rank: pre-token, and not a product the
 * watchlist's own rule sets aside (an exchange, a versioned pool, a wrapped, staked or bridged
 * product of a token that already trades).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol below the watchlist floor. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, multiples, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    watchlist: watchlist.has(s.p.slug),
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple.applied,
      category_median: s.multiple.median,
      category_peers: s.multiple.peers,
      multiple_basis: s.multiple.basis,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      age_multiplier: s.ageMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How gas prices on a chain, in the plain bands a farmer budgets by. */
type ChainClass = 'mainnet' | 'l2' | 'solana' | 'bitcoin' | 'other';

const L2_CHAINS = new Set(['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Ink', 'Unichain', 'Taiko', 'World Chain', 'Soneium', 'Zora']);

function chainClass(chain: string): ChainClass {
  if (chain === 'Ethereum') return 'mainnet';
  if (chain === 'Solana') return 'solana';
  if (chain === 'Bitcoin') return 'bitcoin';
  if (L2_CHAINS.has(chain)) return 'l2';
  return 'other';
}

/** What one transaction roughly costs on a chain of this class, as the farm steps state it. */
function gasFor(cls: ChainClass): string {
  switch (cls) {
    case 'mainnet':
      return 'about $8 to $15 of gas per transaction on Ethereum, less off-peak';
    case 'l2':
      return 'under $1 of gas per transaction on this layer-2 chain';
    case 'solana':
      return 'under $1 of fees per transaction on Solana';
    case 'bitcoin':
      return 'about $1 to $3 of network fees per transaction on Bitcoin';
    default:
      return 'about $1 to $3 of gas per transaction on this chain';
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The three category actions of a farm plan: the core position, the second step, the weekly cadence. */
interface CategoryPlan {
  core: string;
  second: string;
  weekly: string;
}

/** A category's farm actions, in the words a farmer can follow. */
function planFor(p: SnapshotProtocol, capital: number, chain: string): CategoryPlan {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral market') || c.includes('liquidity manager')) {
    return {
      core: `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain}; the vault shares are the position to hold.`,
      second: `After a week, add a second smaller deposit, about half the first, so the position is built over time rather than placed on one day.`,
      weekly: `Check the vault's allocation once a week; the curator rebalances for you, so act only if the vault's strategy or chain changes.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('uncollateralized')) {
    return {
      core: `Supply $${capital} of USDC to ${name} on ${chain}; supplied balances are what lending programs measure.`,
      second: `Borrow a small amount against the supply, no more than a third of it, and keep the health factor well clear of liquidation; an open borrow is a second activity signal.`,
      weekly: `Repay part of the borrow and borrow again, or top the supply up, once a week so the account shows regular use.`,
    };
  }
  if (c.includes('dex')) {
    return {
      core: `Swap about $${capital} through ${name}'s main pool on ${chain}, then provide the proceeds as two-sided liquidity in that pool.`,
      second: `Leave the liquidity in place for the whole hold period; withdrawing and re-adding resets the age of the position.`,
      weekly: `Make one swap of at least $25 through the exchange each week, so the wallet's volume is spread across many days.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged pair, a long and a short of similar size, so the price does not decide the outcome.`,
      second: `Close the pair after a few days and open a fresh one, so the account records completed trades and fees paid, not one open ticket.`,
      weekly: `Trade a small hedged volume every week; derivatives programs count real, spread-out volume and fees, not one large trade.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      core: `Bridge $${capital} of USDC to ${chain} through ${name} and use the funds in an app on the far side the same day.`,
      second: `A few days later, bridge a smaller amount back, or onward to a second chain ${name} serves, so both directions are on record.`,
      weekly: `Make one bridge trip a week in either direction, keep each trip small, and keep every bridge receipt.`,
    };
  }
  if (c.includes('restak') || c.includes('staking')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`,
      second: `Where ${name} offers delegation or restaking of the receipt, switch it on once and leave the delegation active.`,
      weekly: `Claim or restake any rewards once a week, so the position compounds and the wallet stays active.`,
    };
  }
  if (c.includes('yield') || c.includes('leveraged farm') || c === 'farm') {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s main vault or pool on ${chain} and hold the vault shares it issues.`,
      second: `Compound the first yield payment back into the same vault instead of withdrawing it.`,
      weekly: `Check the position once a week and top it up with a small deposit, about $10, so the balance keeps growing.`,
    };
  }
  if (c.includes('basis')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s basis-trading vault on ${chain}; the vault runs the hedge, and your shares are the position.`,
      second: `Do not trade around the vault; basis vaults reward time-weighted balances, so a still position scores better than a busy one.`,
      weekly: `Check the vault's reported balance once a week and add a small top-up, about $10, if it has not grown.`,
    };
  }
  if (c.includes('stable') || c.includes('dual-token')) {
    return {
      core: `Mint or deposit $${capital} through ${name} on ${chain} to hold its stable asset, and keep the stablecoins in the farming wallet.`,
      second: `Put about half of the minted stablecoins to work in a pool or vault ${name} itself offers, if it offers one, and hold the rest.`,
      weekly: `Mint or deposit a small top-up, about $10, once a week so the balance grows steadily.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      core: `Buy or mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it in the farming wallet.`,
      second: `Hold through at least one full month without trading; real-world-asset positions are counted by holding period, not by activity.`,
      weekly: `Check the position's reported value once a week; no trade is needed, and frequent trading only adds cost.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy active.`,
      second: `When the first cover period ends, renew it once so the policy history is continuous.`,
      weekly: `Check the cover is still active once a week; the renewal date is the only deadline that matters.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and take one position in a market you have a view on.`,
      second: `When the market resolves, settle it and roll the proceeds into the next market in the same week.`,
      weekly: `Keep one open position at all times; a continuous record counts for more than trade size.`,
    };
  }
  if (c.includes('payment')) {
    return {
      core: `Route one real payment of about $${capital} through ${name} and keep the receipt; payment products count repeat users, not one-off tests.`,
      second: `Make a second payment in a different week, to a different recipient if you can.`,
      weekly: `Use ${name} for one payment a week, however small, so the account shows a habit.`,
    };
  }
  if (c.includes('chain')) {
    return {
      core: `Bridge $${capital} onto ${chain}, the chain ${name} tracks, and hold it in the farming wallet; a funded wallet on a young chain is the position.`,
      second: `Use one app native to the chain, a swap or a deposit, so the wallet has real on-chain activity, and keep a small gas balance behind.`,
      weekly: `Make one small transaction on the chain each week; chain campaigns count weekly active wallets.`,
    };
  }
  if (c.includes('privacy')) {
    return {
      core: `Deposit $${capital} into ${name}'s pool on ${chain} and make one transfer between two wallets you control.`,
      second: `Leave the balance in the pool for the whole hold period; privacy pools count balances that stay.`,
      weekly: `Check the balance once a week; no further transfer is needed.`,
    };
  }
  if (c.includes('cedefi')) {
    return {
      core: `Deposit $${capital} of USDC into ${name}'s earn product on ${chain} and hold the position it issues.`,
      second: `After the first week, add a second deposit about half the size of the first.`,
      weekly: `Check the position once a week and claim any credited yield back into the same product.`,
    };
  }
  if (c.includes('governance')) {
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
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names: set up a wallet, fund the chain it runs on, take the category's position, deepen it, keep
 * a weekly cadence, hold, and keep a log.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chainClass(chain));
  const plan = planFor(p, capital, chain);
  const reach =
    p.chains.length > 1
      ? `${p.name} runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}); start on ${chain}, the first it lists, and bridge the funds there if they start somewhere else.`
      : `${p.name} runs on ${chain}; move the funds there directly from an exchange or another wallet.`;
  return [
    {
      text: `Set up a fresh wallet for this farm and write its seed phrase on paper, offline; never farm from a wallet that holds your main funds.`,
      cost: 'no fee; the wallet software is free',
      time: '10 minutes',
    },
    {
      text: reach,
      cost: gas,
      time: '15 minutes, or up to an hour when a bridge is involved',
    },
    { text: plan.core, cost: `$${capital} of working capital, plus ${gas}`, time: '15 minutes to set up' },
    { text: plan.second, cost: 'a smaller follow-up amount and one more transaction fee', time: '10 minutes' },
    { text: plan.weekly, cost: gas, time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days without withdrawing; eligibility snapshots reward wallets that stay in, and an early exit wastes the fees already spent.`,
      cost: `the $${capital} stays in the position for the whole hold`,
      time: `${hold} days`,
    },
    {
      text: `Keep a farm log (wallet, chain, dates, amounts, transaction hashes) and check ${p.name}'s own announcements before claiming anything; never pay a fee to claim a reward.`,
      cost: 'nothing to log; claiming, if it ever opens, should be free',
      time: '5 minutes a week',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
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

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global_median,
    peer_count: multiples.peer_count,
    universe_size: snapshot.protocols.length,
    pretoken_size: snapshot.protocols.filter(isPreToken).length,
    tokenized_size: snapshot.protocols.length - snapshot.protocols.filter(isPreToken).length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows: the gate takes 100 to 4,000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
