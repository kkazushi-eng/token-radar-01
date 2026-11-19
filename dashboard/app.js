// Token Launch Radar — dashboard script.
//
// The page is fully static. main.ts writes the whole dataset next to this
// file as data.js (window.RADAR); everything rendered here comes from
// that object and nothing is fetched. Two consistency rules shape the
// code below:
//
//   1. Implied values are recomputed in the browser from the printed
//      factors, so the number on screen can be checked against
//      board.json by eye.
//   2. Farm plans are re-derived here with the same rules lib/model.ts
//      uses, so the detail drawer shows exactly the steps board.json
//      carries for the row.
(() => {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) return;
  const root = document.getElementById('board');

  // UI state: filters, the active tab, sorting, and the open detail row.
  const state = {
    query: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sortKey: 'implied',
    sortDir: -1,
    selected: null,
  };

  // --------------------------------------------------------------
  // Formatting
  // --------------------------------------------------------------

  const plainUsd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  function fmtUsd(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    const magnitude = Math.abs(n);
    if (magnitude >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (magnitude >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (magnitude >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return plainUsd.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function fmtMult(m) {
    if (m === null || m === undefined || !Number.isFinite(m)) return 'n/a';
    return Math.round(m * 1000) / 1000 + 'x';
  }

  const displayCategory = (row) => row.category || 'Uncategorized';

  /** Recompute a row's implied value from its printed factors. */
  function impliedOf(row) {
    const raw = row.tvl_usd * row.category_multiple * row.growth_multiplier * row.age_multiplier;
    return Math.max(1, Math.round(raw));
  }

  // --------------------------------------------------------------
  // Tiny DOM builder: h(tag, attrs, ...children)
  // attrs understands class / text / html / on<event> specially;
  // anything else becomes an attribute, skipped when null.
  // --------------------------------------------------------------

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
      }
    }
    const append = (child) => {
      if (child === null || child === undefined) return;
      if (Array.isArray(child)) child.forEach(append);
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    };
    children.forEach(append);
    return node;
  }

  // --------------------------------------------------------------
  // Farm-plan derivation — mirrors lib/model.ts rule for rule.
  // --------------------------------------------------------------

  const firstChain = (p) => (p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain');

  const L2_SET = new Set([
    'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle',
    'Blast', 'Mode', 'Ink', 'Unichain', 'Taiko', 'World Chain', 'Soneium', 'Zora',
  ]);

  function chainKind(chain) {
    if (chain === 'Ethereum') return 'mainnet';
    if (chain === 'Solana') return 'solana';
    if (chain === 'Bitcoin') return 'bitcoin';
    if (L2_SET.has(chain)) return 'layer2';
    return 'other';
  }

  const GAS_TEXT = {
    mainnet: 'about $8 to $15 of gas per transaction on Ethereum, less off-peak',
    layer2: 'under $1 of gas per transaction on this layer-2 chain',
    solana: 'under $1 of fees per transaction on Solana',
    bitcoin: 'about $1 to $3 of network fees per transaction on Bitcoin',
    other: 'about $1 to $3 of gas per transaction on this chain',
  };
  const gasText = (chain) => GAS_TEXT[chainKind(chain)];

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function categoryActions(p, capital, chain) {
    const cat = (p.category || '').toLowerCase();
    const name = p.name;
    const has = (...words) => words.some((w) => cat.includes(w));

    if (has('curator', 'allocator', 'collateral market', 'liquidity manager')) return {
      core: `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain}; the vault shares are the position to hold.`,
      second: 'After a week, add a second smaller deposit, about half the first, so the position is built over time rather than placed on one day.',
      weekly: "Check the vault's allocation once a week; the curator rebalances for you, so act only if the vault's strategy or chain changes.",
    };
    if (has('lend', 'cdp', 'uncollateralized')) return {
      core: `Supply $${capital} of USDC to ${name} on ${chain}; supplied balances are what lending programs measure.`,
      second: 'Borrow a small amount against the supply, no more than a third of it, and keep the health factor well clear of liquidation; an open borrow is a second activity signal.',
      weekly: 'Repay part of the borrow and borrow again, or top the supply up, once a week so the account shows regular use.',
    };
    if (has('dex')) return {
      core: `Swap about $${capital} through ${name}'s main pool on ${chain}, then provide the proceeds as two-sided liquidity in that pool.`,
      second: 'Leave the liquidity in place for the whole hold period; withdrawing and re-adding resets the age of the position.',
      weekly: "Make one swap of at least $25 through the exchange each week, so the wallet's volume is spread across many days.",
    };
    if (has('derivative', 'perpetual', 'option')) return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged pair, a long and a short of similar size, so the price does not decide the outcome.`,
      second: 'Close the pair after a few days and open a fresh one, so the account records completed trades and fees paid, not one open ticket.',
      weekly: 'Trade a small hedged volume every week; derivatives programs count real, spread-out volume and fees, not one large trade.',
    };
    if (has('bridge')) return {
      core: `Bridge $${capital} of USDC to ${chain} through ${name} and use the funds in an app on the far side the same day.`,
      second: `A few days later, bridge a smaller amount back, or onward to a second chain ${name} serves, so both directions are on record.`,
      weekly: 'Make one bridge trip a week in either direction, keep each trip small, and keep every bridge receipt.',
    };
    if (has('restak', 'staking')) return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the same wallet.`,
      second: `Where ${name} offers delegation or restaking of the receipt, switch it on once and leave the delegation active.`,
      weekly: 'Claim or restake any rewards once a week, so the position compounds and the wallet stays active.',
    };
    if (has('yield', 'leveraged farm') || cat === 'farm') return {
      core: `Deposit $${capital} of USDC into ${name}'s main vault or pool on ${chain} and hold the vault shares it issues.`,
      second: 'Compound the first yield payment back into the same vault instead of withdrawing it.',
      weekly: 'Check the position once a week and top it up with a small deposit, about $10, so the balance keeps growing.',
    };
    if (has('basis')) return {
      core: `Deposit $${capital} of USDC into ${name}'s basis-trading vault on ${chain}; the vault runs the hedge, and your shares are the position.`,
      second: 'Do not trade around the vault; basis vaults reward time-weighted balances, so a still position scores better than a busy one.',
      weekly: "Check the vault's reported balance once a week and add a small top-up, about $10, if it has not grown.",
    };
    if (has('stable', 'dual-token')) return {
      core: `Mint or deposit $${capital} through ${name} on ${chain} to hold its stable asset, and keep the stablecoins in the farming wallet.`,
      second: `Put about half of the minted stablecoins to work in a pool or vault ${name} itself offers, if it offers one, and hold the rest.`,
      weekly: 'Mint or deposit a small top-up, about $10, once a week so the balance grows steadily.',
    };
    if (has('rwa')) return {
      core: `Buy or mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it in the farming wallet.`,
      second: 'Hold through at least one full month without trading; real-world-asset positions are counted by holding period, not by activity.',
      weekly: "Check the position's reported value once a week; no trade is needed, and frequent trading only adds cost.",
    };
    if (has('insurance')) return {
      core: `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy active.`,
      second: 'When the first cover period ends, renew it once so the policy history is continuous.',
      weekly: 'Check the cover is still active once a week; the renewal date is the only deadline that matters.',
    };
    if (has('prediction')) return {
      core: `Fund $${capital} on ${name} and take one position in a market you have a view on.`,
      second: 'When the market resolves, settle it and roll the proceeds into the next market in the same week.',
      weekly: 'Keep one open position at all times; a continuous record counts for more than trade size.',
    };
    if (has('payment')) return {
      core: `Route one real payment of about $${capital} through ${name} and keep the receipt; payment products count repeat users, not one-off tests.`,
      second: 'Make a second payment in a different week, to a different recipient if you can.',
      weekly: `Use ${name} for one payment a week, however small, so the account shows a habit.`,
    };
    if (has('chain')) return {
      core: `Bridge $${capital} onto ${chain}, the chain ${name} tracks, and hold it in the farming wallet; a funded wallet on a young chain is the position.`,
      second: 'Use one app native to the chain, a swap or a deposit, so the wallet has real on-chain activity, and keep a small gas balance behind.',
      weekly: 'Make one small transaction on the chain each week; chain campaigns count weekly active wallets.',
    };
    if (has('privacy')) return {
      core: `Deposit $${capital} into ${name}'s pool on ${chain} and make one transfer between two wallets you control.`,
      second: 'Leave the balance in the pool for the whole hold period; privacy pools count balances that stay.',
      weekly: 'Check the balance once a week; no further transfer is needed.',
    };
    if (has('cedefi')) return {
      core: `Deposit $${capital} of USDC into ${name}'s earn product on ${chain} and hold the position it issues.`,
      second: 'After the first week, add a second deposit about half the size of the first.',
      weekly: 'Check the position once a week and claim any credited yield back into the same product.',
    };
    if (has('governance')) return {
      core: `Deposit $${capital} into the incentive program ${name} runs on ${chain}, in the asset the program measures.`,
      second: 'If the program offers a vote or a gauge, cast one; governance activity is a second, cheap signal.',
      weekly: 'Check the program balance once a week and top it up if it has fallen.',
    };
    return {
      core: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
      second: 'After a week, add a second smaller deposit, about half the first, so the position is built over time.',
      weekly: 'Make one small qualifying action each week, a deposit, a claim or a vote, so the wallet stays active.',
    };
  }

  function flattenStep(step) {
    let text = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (text.length > 600) text = text.slice(0, 596) + '...';
    if (text.length < 20) text += " Hold the position and check the protocol's own page.";
    return text;
  }

  function farmStepsFor(p) {
    const chain = firstChain(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const gas = gasText(chain);
    const actions = categoryActions(p, capital, chain);
    const chains = p.chains || [];
    const reach = chains.length > 1
      ? `${p.name} runs on ${chains.length} chains (${chains.slice(0, 3).join(', ')}); start on ${chain}, the first it lists, and bridge the funds there if they start somewhere else.`
      : `${p.name} runs on ${chain}; move the funds there directly from an exchange or another wallet.`;
    const steps = [
      { text: 'Set up a fresh wallet for this farm and write its seed phrase on paper, offline; never farm from a wallet that holds your main funds.', cost: 'no fee; the wallet software is free', time: '10 minutes' },
      { text: reach, cost: gas, time: '15 minutes, or up to an hour when a bridge is involved' },
      { text: actions.core, cost: '$' + capital + ' of working capital, plus ' + gas, time: '15 minutes to set up' },
      { text: actions.second, cost: 'a smaller follow-up amount and one more transaction fee', time: '10 minutes' },
      { text: actions.weekly, cost: gas, time: '10 minutes a week' },
      { text: `Hold the position for at least ${hold} days without withdrawing; eligibility snapshots reward wallets that stay in, and an early exit wastes the fees already spent.`, cost: `the $${capital} stays in the position for the whole hold`, time: hold + ' days' },
      { text: `Keep a farm log (wallet, chain, dates, amounts, transaction hashes) and check ${p.name}'s own announcements before claiming anything; never pay a fee to claim a reward.`, cost: 'nothing to log; claiming, if it ever opens, should be free', time: '5 minutes a week' },
    ];
    return steps.map(flattenStep);
  }

  // --------------------------------------------------------------
  // URL hash <-> state, so a filtered view or an open protocol can
  // be linked and restored.
  // --------------------------------------------------------------

  function readHash() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    if (params.get('q')) state.query = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w')) state.watchlistOnly = params.get('w') === '1';
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.selected) params.set('p', state.selected);
    const encoded = params.toString();
    const target = encoded ? '#' + encoded : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', target);
  }

  // --------------------------------------------------------------
  // Filtering and sorting
  // --------------------------------------------------------------

  function visibleRows() {
    const needle = state.query.trim().toLowerCase();
    return DATA.rows.filter((row) => {
      if (state.watchlistOnly && !row.watchlist) return false;
      if (state.category !== 'all' && displayCategory(row) !== state.category) return false;
      if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
      if (!needle) return true;
      const haystack = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }

  function sortValue(row, key) {
    switch (key) {
      case 'name': return row.name.toLowerCase();
      case 'tvl': return row.tvl_usd;
      case 'growth': return row.change_7d === null ? -Infinity : row.change_7d;
      case 'age': return row.age_days === null ? Infinity : row.age_days;
      case 'multiple': return row.tvl_usd > 0 ? row.implied_value_usd / row.tvl_usd : 0;
      default: return row.implied_value_usd;
    }
  }

  function applySort(list) {
    const key = state.sortKey;
    const dir = state.sortDir;
    return list.slice().sort((a, b) => {
      const av = sortValue(a, key);
      const bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // --------------------------------------------------------------
  // Page sections
  // --------------------------------------------------------------

  function headerSection() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' },
        h('span', { class: 'mark' }),
        h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })));
  }

  function ledeSection() {
    const floorMillions = Math.round(DATA.floor_usd / 1e6);
    const intro =
      'Every protocol in the snapshot that records no token is scored by one model: its category is priced at the market cap its tokenized peers actually carry against their TVL, then adjusted for seven-day growth and for how long it has run with no token. The watchlist is the floor, not the ceiling: all ' +
      DATA.watchlist_size + ' watchlist protocols are here, plus ' + DATA.early_size +
      ' early protocols below the $' + floorMillions + 'M floor. An implied value is the model\u2019s claim, not a promise.';
    const fact = (label, value) =>
      h('div', { class: 'fact' }, h('span', { text: label }), h('b', { text: value }));
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: 'Pre-token protocols, ranked by what a launch would be worth' }),
        h('p', { text: intro })),
      h('div', { class: 'facts' },
        fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        fact('Protocols ranked', String(DATA.board_size)),
        fact('Early rows below the floor', String(DATA.early_size)),
        fact('Tokenized peers priced', String(DATA.peer_count)),
        fact('Global median multiple', fmtMult(DATA.global_multiple))));
  }

  function controlsSection() {
    const categories = [...new Set(DATA.rows.map(displayCategory))].sort();
    const chainCounts = new Map();
    for (const row of DATA.rows) {
      for (const chain of row.chains || []) {
        chainCounts.set(chain, (chainCounts.get(chain) || 0) + 1);
      }
    }
    const chains = [...chainCounts.keys()].sort((a, b) => {
      const byCount = chainCounts.get(b) - chainCounts.get(a);
      return byCount !== 0 ? byCount : a < b ? -1 : 1;
    });

    const search = h('input', {
      type: 'search', id: 'q', placeholder: 'Search name, category or chain',
      value: state.query, 'aria-label': 'Search the board',
    });
    search.addEventListener('input', () => { state.query = search.value; writeHash(); render(); });

    const categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map((c) => h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })));
    categorySelect.addEventListener('change', () => { state.category = categorySelect.value; writeHash(); render(); });

    const chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map((c) => h('option', {
        value: c, text: c + ' (' + chainCounts.get(c) + ')',
        selected: c === state.chain ? 'selected' : null,
      })));
    chainSelect.addEventListener('change', () => { state.chain = chainSelect.value; writeHash(); render(); });

    const watchlistToggle = h('button', {
      type: 'button', class: 'toggle', text: 'Watchlist only',
      'aria-pressed': state.watchlistOnly ? 'true' : 'false',
      onclick: () => { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); },
    });
    const preTab = h('button', {
      type: 'button', text: 'Pre-token',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      onclick: () => { state.tab = 'pre-token'; render(); },
    });
    const liveTab = h('button', {
      type: 'button', text: 'Live token',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      onclick: () => { state.tab = 'live'; render(); },
    });

    const countText = state.tab === 'pre-token'
      ? visibleRows().length + ' of ' + DATA.board_size + ' rows shown'
      : DATA.live.length + ' live-token protocols';

    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), categorySelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'List' }), watchlistToggle),
      h('div', { class: 'field' },
        h('span', { class: 'sub', text: 'Token status' }),
        h('div', { class: 'tabs' }, preTab, liveTab)),
      h('span', { class: 'count', text: countText }));
  }

  function sortableHeader(key, label) {
    const isActive = state.sortKey === key;
    const arrow = isActive ? h('span', { 'aria-hidden': 'true', text: state.sortDir < 0 ? ' \u25bc' : ' \u25b2' }) : null;
    return h('th', { scope: 'col' },
      h('button', {
        type: 'button',
        onclick: () => {
          if (state.sortKey === key) state.sortDir = -state.sortDir;
          else { state.sortKey = key; state.sortDir = -1; }
          render();
        },
      }, label, arrow));
  }

  function boardTable() {
    const list = applySort(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' },
        h('div', { class: 'empty' },
          h('h2', { text: 'No protocol matches that filter' }),
          h('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
          h('button', {
            class: 'button primary', type: 'button', text: 'Clear filters',
            onclick: () => {
              state.query = '';
              state.category = 'all';
              state.chain = 'all';
              state.watchlistOnly = false;
              writeHash();
              render();
            },
          })));
    }

    let peak = 1;
    for (const row of list) if (row.implied_value_usd > peak) peak = row.implied_value_usd;

    const body = h('tbody');
    for (const row of list) {
      const growthClass = row.change_7d === null ? '' : row.change_7d >= 0 ? 'pos' : 'neg';
      const chainList = row.chains || [];
      const chainText = chainList.length
        ? chainList.slice(0, 3).join(', ') + (chainList.length > 3 ? ' +' + (chainList.length - 3) : '')
        : 'unnamed';
      const barWidth = Math.max(3, Math.round((row.implied_value_usd / peak) * 100));
      body.appendChild(h('tr', {
        'data-selected': state.selected === row.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: () => openDetail(row.slug),
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetail(row.slug);
          }
        },
      },
        h('td', { class: 'num', text: String(row.rank) }),
        h('td', null,
          h('div', { class: 'name' },
            h('b', { text: row.name }),
            h('span', {
              class: 'tag ' + (row.watchlist ? 'wl' : 'early'),
              text: row.watchlist ? 'Watchlist' : 'Early',
            }))),
        h('td', { text: displayCategory(row) }),
        h('td', { class: 'chains', text: chainText }),
        h('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: row.change_7d === null ? 'n/a' : fmtPct(row.change_7d) }),
        h('td', null,
          h('div', { class: 'implied' },
            h('div', { class: 'bar', 'aria-hidden': 'true' },
              h('i', { style: 'width:' + barWidth + '%' })),
            h('span', { class: 'num', text: fmtUsd(row.implied_value_usd) }))),
        h('td', { class: 'num', text: fmtMult(row.implied_value_usd / row.tvl_usd) })));
    }

    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', {
            class: 'sub',
            text: 'Pre-token protocols, strongest implied value first. The multiple is the implied value against TVL. Select a row for its model breakdown and farm plan.',
          }),
          h('thead', null,
            h('tr', null,
              sortableHeader('implied', 'Rank'),
              sortableHeader('name', 'Protocol'),
              h('th', { scope: 'col', text: 'Category' }),
              h('th', { scope: 'col', text: 'Chains' }),
              sortableHeader('tvl', 'TVL'),
              sortableHeader('growth', '7d'),
              sortableHeader('implied', 'Implied value'),
              sortableHeader('multiple', 'Multiple'))),
          body)));
  }

  function liveTable() {
    const body = h('tbody');
    for (const row of DATA.live) {
      const multiple = row.mcap_usd && row.tvl_usd ? fmtMult(row.mcap_usd / row.tvl_usd) : 'n/a';
      const chainNote = row.chains && row.chains.length ? row.chains.slice(0, 2).join(', ') : 'an unnamed chain';
      body.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null,
          h('div', { class: 'name' },
            h('b', { text: row.name }),
            h('span', { class: 'sub', text: chainNote }))),
        h('td', { text: displayCategory(row) }),
        h('td', { class: 'num', text: fmtUsd(row.tvl_usd) }),
        h('td', {
          class: 'num ' + (row.change_7d !== null && row.change_7d >= 0 ? 'pos' : 'neg'),
          text: fmtPct(row.change_7d),
        }),
        h('td', { class: 'num', text: fmtUsd(row.mcap_usd) }),
        h('td', { class: 'num', text: multiple }),
        h('td', null, h('span', { class: 'status live', text: 'already trades' }))));
    }
    const headRow = h('tr', null,
      ['Status', 'Protocol', 'Category', 'TVL', '7d', 'Market cap', 'Mcap / TVL', 'Token']
        .map((label) => h('th', { scope: 'col', text: label })));
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', {
            class: 'sub',
            text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking; their market cap against TVL is exactly what prices the pre-token board.',
          }),
          h('thead', null, headRow),
          body)));
  }

  function categoryTable() {
    const byCategory = new Map();
    for (const row of DATA.rows) {
      const name = displayCategory(row);
      if (!byCategory.has(name)) {
        byCategory.set(name, {
          rows: 0,
          peers: row.category_peers,
          median: row.category_median,
          applied: row.category_multiple,
          basis: row.multiple_basis,
        });
      }
      byCategory.get(name).rows += 1;
    }
    const top = [...byCategory.entries()]
      .sort((a, b) => b[1].rows - a[1].rows || (a[0] < b[0] ? -1 : 1))
      .slice(0, 12);

    const body = h('tbody');
    for (const [name, info] of top) {
      body.appendChild(h('tr', null,
        h('td', { text: name }),
        h('td', { class: 'num', text: String(info.rows) }),
        h('td', { class: 'num', text: info.peers > 0 ? String(info.peers) : 'none' }),
        h('td', { class: 'num', text: info.median === null ? 'n/a' : fmtMult(info.median) }),
        h('td', { class: 'num', text: fmtMult(info.applied) })));
    }
    const headRow = h('tr', null,
      ['Category', 'Board rows', 'Tokenized peers', 'Peer median', 'Applied']
        .map((label) => h('th', { scope: 'col', text: label })));
    return h('div', { class: 'table-wrap' },
      h('table', { class: 'mini' }, null,
        h('caption', {
          class: 'sub',
          text: 'The multiples the snapshot itself carries, per category on the board. A median from few peers is shrunk toward the global median; a category with no tokenized peer is priced at the global median.',
        }),
        h('thead', null, headRow),
        body));
  }

  function modelPanel() {
    const m = DATA.model;
    const floorMillions = Math.round(DATA.floor_usd / 1e6);
    const intro =
      'No protocol name is special-cased and no row is hand-picked: one function scores every protocol from the snapshot\u2019s own figures. The market prices the board: ' +
      DATA.peer_count + ' protocols in this snapshot carry both a market cap and a TVL, and the median of them is worth ' +
      fmtMult(DATA.global_multiple) + ' of its TVL. Each category is priced at its own peers\u2019 median multiple, each peer\u2019s multiple capped at ' +
      m.peer_cap + 'x before the median, the median shrunk toward the global one with weight peers/(peers + ' + m.shrink_k +
      ') and clamped to ' + fmtMult(m.multiple_floor) + ' to ' + fmtMult(m.multiple_cap) +
      ', so a category with one rich peer cannot set its own price.';
    const formula =
      'implied = round( TVL x category multiple x (1 + clamp(change_7d, -' + m.growth_clamp + ', +' + m.growth_clamp +
      ') / 100 x ' + m.growth_weight + ') x (' + m.age_floor + ' + ' + m.age_range +
      ' x min(age_days, ' + m.age_days_cap + ') / ' + m.age_days_cap + ') )';
    const outro =
      'Growth is the protocol\u2019s TVL change over seven days, clamped so one hot week moves a value by at most a fifth. Age is the time since the protocol was first tracked, the record of how long it has run with no token; a protocol with no listing date is scored at ' +
      m.unknown_age_days + ' days. Below the $' + floorMillions + 'M floor the board applies the watchlist\u2019s own product rules: exchanges, versioned pools and wrapped, staked or bridged products of tokens that already trade are set aside. ' +
      DATA.pretoken_size + ' of the snapshot\u2019s ' + DATA.universe_size + ' protocols record no token; the rest already trade and are never ranked.';
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: intro }),
      h('div', { class: 'formula' }, formula),
      h('p', { class: 'sub', text: outro }),
      categoryTable());
  }

  // --------------------------------------------------------------
  // Detail drawer
  // --------------------------------------------------------------

  const dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => { state.selected = null; writeHash(); });

  function basisNote(row) {
    if (row.multiple_basis === 'global') {
      return 'No tokenized protocol in this category carries a market cap, so the global median of ' +
        DATA.peer_count + ' tokenized protocols prices it.';
    }
    if (row.multiple_basis === 'shrunk') {
      return 'The median of ' + row.category_peers + ' tokenized ' + displayCategory(row) +
        ' peer' + (row.category_peers === 1 ? '' : 's') + ' (' + fmtMult(row.category_median) +
        '), shrunk toward the global median ' + fmtMult(DATA.global_multiple) + ' because the peer count is small.';
    }
    return 'The median of ' + row.category_peers + ' tokenized ' + displayCategory(row) +
      ' protocols, lightly shrunk toward the global median ' + fmtMult(DATA.global_multiple) + '.';
  }

  function openDetail(slug) {
    const row = DATA.rows.find((r) => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';

    const steps = farmStepsFor(row);
    const capital = capitalFor(row);
    const hold = holdDaysFor(row.age_days);
    const recomputed = impliedOf(row);
    const chainSummary = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    const tracked = row.listed_at ? ' \u00b7 tracked since ' + row.listed_at : ' \u00b7 no listing date on record';
    const placement = row.watchlist ? ' \u00b7 Watchlist' : ' \u00b7 Early, below the floor';

    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + placement }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: displayCategory(row) + ' on ' + chainSummary + tracked })),
      h('button', {
        class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close',
        onclick: () => dialog.close(),
      })));

    const equationRow = (label, value, extra) =>
      h('div', extra || null, h('span', { text: label }), h('b', { class: 'num', text: value }));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        equationRow('TVL (snapshot)', fmtUsd(row.tvl_usd)),
        equationRow('Category multiple', fmtMult(row.category_multiple)),
        equationRow('Growth factor (7d ' + fmtPct(row.change_7d) + ')', fmtMult(row.growth_multiplier)),
        equationRow('Age factor (' + fmtAge(row.age_days) + ' with no token)', fmtMult(row.age_multiplier)),
        equationRow('Implied value', fmtUsd(row.implied_value_usd), { class: 'total' }),
        equationRow('Implied multiple of TVL', fmtMult(row.implied_value_usd / row.tvl_usd))),
      h('p', { class: 'sub', text: basisNote(row) }),
      h('p', {
        class: 'sub',
        text: 'Model ' + DATA.model_version + ': this page recomputes the row from the printed factors as ' +
          fmtUsd(recomputed) +
          (recomputed === row.implied_value_usd
            ? ', the same number board.json carries.'
            : ', which differs from the board: the data would be stale.') +
          ' An implied value is an estimate of what a launch could be worth if the record held, not a price and not a prediction that a token comes.',
      })));

    const stepItems = steps.map((step) => {
      const at = step.indexOf(' Cost: ');
      const action = at >= 0 ? step.slice(0, at) : step;
      const tail = at >= 0 ? step.slice(at + 1) : '';
      return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
    });
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('p', {
        class: 'sub effort',
        text: 'Effort: about $' + capital + ' of working capital, roughly 15 minutes a week, held for ' +
          hold + ' days. Fees depend on the chain: ' + gasText(firstChain(row)) + '.',
      }),
      h('ol', { class: 'steps' }, stepItems)));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // --------------------------------------------------------------
  // Render loop: rebuild the shell from state on every change.
  // --------------------------------------------------------------

  function render() {
    root.textContent = '';
    const shell = h('div', { class: 'shell' });
    shell.appendChild(headerSection());
    shell.appendChild(ledeSection());
    shell.appendChild(controlsSection());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    root.appendChild(shell);
    root.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) root.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog.open) dialog.close();
  });
})();
