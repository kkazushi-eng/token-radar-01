// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a filterable table, a per-protocol detail drawer with the model's own factors
// and the protocol's farm plan. No network: every byte it shows is in data.js. The page recomputes
// each row's implied value from the factors it prints, so what the screenshots show and what
// board.json carries are the same arithmetic, visibly.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(m) {
    if (m === null || m === undefined || !isFinite(m)) return 'n/a';
    return (Math.round(m * 1000) / 1000) + 'x';
  }
  function catName(r) { return r.category || 'Uncategorized'; }
  // The model in one function: the page recomputes a row from the factors it prints (TVL and the
  // three rounded factors in data.js) and checks the number board.json carries.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.growth_multiplier * row.age_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  var L2_CHAINS = ['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Ink', 'Unichain', 'Taiko', 'World Chain', 'Soneium', 'Zora'];
  function chainClass(chain) {
    if (chain === 'Ethereum') return 'mainnet';
    if (chain === 'Solana') return 'solana';
    if (chain === 'Bitcoin') return 'bitcoin';
    if (L2_CHAINS.indexOf(chain) >= 0) return 'l2';
    return 'other';
  }
  function gasFor(cls) {
    if (cls === 'mainnet') return 'about $8 to $15 of gas per transaction on Ethereum, less off-peak';
    if (cls === 'l2') return 'under $1 of gas per transaction on this layer-2 chain';
    if (cls === 'solana') return 'under $1 of fees per transaction on Solana';
    if (cls === 'bitcoin') return 'about $1 to $3 of network fees per transaction on Bitcoin';
    return 'about $1 to $3 of gas per transaction on this chain';
  }
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
  function planFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('collateral market') >= 0 || c.indexOf('liquidity manager') >= 0) return {
      core: "Deposit $" + capital + " of USDC into one of " + name + "'s curated vaults on " + chain + "; the vault shares are the position to hold.",
      second: "After a week, add a second smaller deposit, about half the first, so the position is built over time rather than placed on one day.",
      weekly: "Check the vault's allocation once a week; the curator rebalances for you, so act only if the vault's strategy or chain changes."
    };
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('uncollateralized') >= 0) return {
      core: "Supply $" + capital + " of USDC to " + name + " on " + chain + "; supplied balances are what lending programs measure.",
      second: "Borrow a small amount against the supply, no more than a third of it, and keep the health factor well clear of liquidation; an open borrow is a second activity signal.",
      weekly: "Repay part of the borrow and borrow again, or top the supply up, once a week so the account shows regular use."
    };
    if (c.indexOf('dex') >= 0) return {
      core: "Swap about $" + capital + " through " + name + "'s main pool on " + chain + ", then provide the proceeds as two-sided liquidity in that pool.",
      second: "Leave the liquidity in place for the whole hold period; withdrawing and re-adding resets the age of the position.",
      weekly: "Make one swap of at least $25 through the exchange each week, so the wallet's volume is spread across many days."
    };
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('option') >= 0) return {
      core: "Deposit $" + capital + " of USDC as margin on " + name + " and open one small hedged pair, a long and a short of similar size, so the price does not decide the outcome.",
      second: "Close the pair after a few days and open a fresh one, so the account records completed trades and fees paid, not one open ticket.",
      weekly: "Trade a small hedged volume every week; derivatives programs count real, spread-out volume and fees, not one large trade."
    };
    if (c.indexOf('bridge') >= 0) return {
      core: "Bridge $" + capital + " of USDC to " + chain + " through " + name + " and use the funds in an app on the far side the same day.",
      second: "A few days later, bridge a smaller amount back, or onward to a second chain " + name + " serves, so both directions are on record.",
      weekly: "Make one bridge trip a week in either direction, keep each trip small, and keep every bridge receipt."
    };
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return {
      core: "Stake $" + capital + " of the chain's staking asset through " + name + " on " + chain + " and keep the staking receipt in the same wallet.",
      second: "Where " + name + " offers delegation or restaking of the receipt, switch it on once and leave the delegation active.",
      weekly: "Claim or restake any rewards once a week, so the position compounds and the wallet stays active."
    };
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c === 'farm') return {
      core: "Deposit $" + capital + " of USDC into " + name + "'s main vault or pool on " + chain + " and hold the vault shares it issues.",
      second: "Compound the first yield payment back into the same vault instead of withdrawing it.",
      weekly: "Check the position once a week and top it up with a small deposit, about $10, so the balance keeps growing."
    };
    if (c.indexOf('basis') >= 0) return {
      core: "Deposit $" + capital + " of USDC into " + name + "'s basis-trading vault on " + chain + "; the vault runs the hedge, and your shares are the position.",
      second: "Do not trade around the vault; basis vaults reward time-weighted balances, so a still position scores better than a busy one.",
      weekly: "Check the vault's reported balance once a week and add a small top-up, about $10, if it has not grown."
    };
    if (c.indexOf('stable') >= 0 || c.indexOf('dual-token') >= 0) return {
      core: "Mint or deposit $" + capital + " through " + name + " on " + chain + " to hold its stable asset, and keep the stablecoins in the farming wallet.",
      second: "Put about half of the minted stablecoins to work in a pool or vault " + name + " itself offers, if it offers one, and hold the rest.",
      weekly: "Mint or deposit a small top-up, about $10, once a week so the balance grows steadily."
    };
    if (c.indexOf('rwa') >= 0) return {
      core: "Buy or mint $" + capital + " of " + name + "'s tokenized asset on " + chain + " and hold it in the farming wallet.",
      second: "Hold through at least one full month without trading; real-world-asset positions are counted by holding period, not by activity.",
      weekly: "Check the position's reported value once a week; no trade is needed, and frequent trading only adds cost."
    };
    if (c.indexOf('insurance') >= 0) return {
      core: "Buy $" + capital + " of cover from " + name + " on " + chain + " for a position you actually hold, and keep the policy active.",
      second: "When the first cover period ends, renew it once so the policy history is continuous.",
      weekly: "Check the cover is still active once a week; the renewal date is the only deadline that matters."
    };
    if (c.indexOf('prediction') >= 0) return {
      core: "Fund $" + capital + " on " + name + " and take one position in a market you have a view on.",
      second: "When the market resolves, settle it and roll the proceeds into the next market in the same week.",
      weekly: "Keep one open position at all times; a continuous record counts for more than trade size."
    };
    if (c.indexOf('payment') >= 0) return {
      core: "Route one real payment of about $" + capital + " through " + name + " and keep the receipt; payment products count repeat users, not one-off tests.",
      second: "Make a second payment in a different week, to a different recipient if you can.",
      weekly: "Use " + name + " for one payment a week, however small, so the account shows a habit."
    };
    if (c.indexOf('chain') >= 0) return {
      core: "Bridge $" + capital + " onto " + chain + ", the chain " + name + " tracks, and hold it in the farming wallet; a funded wallet on a young chain is the position.",
      second: "Use one app native to the chain, a swap or a deposit, so the wallet has real on-chain activity, and keep a small gas balance behind.",
      weekly: "Make one small transaction on the chain each week; chain campaigns count weekly active wallets."
    };
    if (c.indexOf('privacy') >= 0) return {
      core: "Deposit $" + capital + " into " + name + "'s pool on " + chain + " and make one transfer between two wallets you control.",
      second: "Leave the balance in the pool for the whole hold period; privacy pools count balances that stay.",
      weekly: "Check the balance once a week; no further transfer is needed."
    };
    if (c.indexOf('cedefi') >= 0) return {
      core: "Deposit $" + capital + " of USDC into " + name + "'s earn product on " + chain + " and hold the position it issues.",
      second: "After the first week, add a second deposit about half the size of the first.",
      weekly: "Check the position once a week and claim any credited yield back into the same product."
    };
    if (c.indexOf('governance') >= 0) return {
      core: "Deposit $" + capital + " into the incentive program " + name + " runs on " + chain + ", in the asset the program measures.",
      second: "If the program offers a vote or a gauge, cast one; governance activity is a second, cheap signal.",
      weekly: "Check the program balance once a week and top it up if it has fallen."
    };
    return {
      core: "Deposit $" + capital + " of USDC into " + name + " on " + chain + " and keep the position open.",
      second: "After a week, add a second smaller deposit, about half the first, so the position is built over time.",
      weekly: "Make one small qualifying action each week, a deposit, a claim or a vote, so the wallet stays active."
    };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chainClass(chain));
    var plan = planFor(p, capital, chain);
    var reach = p.chains && p.chains.length > 1
      ? p.name + ' runs on ' + p.chains.length + ' chains (' + p.chains.slice(0, 3).join(', ') + '); start on ' + chain + ', the first it lists, and bridge the funds there if they start somewhere else.'
      : p.name + ' runs on ' + chain + '; move the funds there directly from an exchange or another wallet.';
    return [
      { text: 'Set up a fresh wallet for this farm and write its seed phrase on paper, offline; never farm from a wallet that holds your main funds.', cost: 'no fee; the wallet software is free', time: '10 minutes' },
      { text: reach, cost: gas, time: '15 minutes, or up to an hour when a bridge is involved' },
      { text: plan.core, cost: '$' + capital + ' of working capital, plus ' + gas, time: '15 minutes to set up' },
      { text: plan.second, cost: 'a smaller follow-up amount and one more transaction fee', time: '10 minutes' },
      { text: plan.weekly, cost: gas, time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days without withdrawing; eligibility snapshots reward wallets that stay in, and an early exit wastes the fees already spent.', cost: 'the $' + capital + ' stays in the position for the whole hold', time: hold + ' days' },
      { text: "Keep a farm log (wallet, chain, dates, amounts, transaction hashes) and check " + p.name + "'s own announcements before claiming anything; never pay a fee to claim a reward.", cost: 'nothing to log; claiming, if it ever opens, should be free', time: '5 minutes a week' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('w')) state.watchlistOnly = params.get('w') === '1';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && catName(r) !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by what a launch would be worth' }),
        el('p', { text: 'Every protocol in the snapshot that records no token is scored by one model: its category is priced at the market cap its tokenized peers actually carry against their TVL, then adjusted for seven-day growth and for how long it has run with no token. The watchlist is the floor, not the ceiling: all ' + DATA.watchlist_size + ' watchlist protocols are here, plus ' + DATA.early_size + ' early protocols below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. An implied value is the model\u2019s claim, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Protocols ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Tokenized peers priced' }), el('b', { text: String(DATA.peer_count) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global median multiple' }), el('b', { text: fmtMult(DATA.global_multiple) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(catName))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('button', { type: 'button', class: 'toggle', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'List' }), wl),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chainText = (r.chains && r.chains.length) ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'unnamed';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'tag ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' })
        )),
        el('td', { text: catName(r) }),
        el('td', { class: 'chains', text: chainText }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: fmtMult(r.implied_value_usd / r.tvl_usd) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. The multiple is the implied value against TVL. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Chains' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('implied', 'Implied value'),
            sortHeader('multiple', 'Multiple')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var mult = r.mcap_usd && r.tvl_usd ? fmtMult(r.mcap_usd / r.tvl_usd) : 'n/a';
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { text: catName(r) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: mult }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking; their market cap against TVL is exactly what prices the pre-token board.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function categoryTable() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = catName(r);
      if (!byCat[c]) byCat[c] = { rows: 0, peers: r.category_peers, median: r.category_median, applied: r.category_multiple, basis: r.multiple_basis };
      byCat[c].rows++;
    });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b].rows - byCat[a].rows || (a < b ? -1 : 1); }).slice(0, 12);
    var tbody = el('tbody');
    cats.forEach(function (c) {
      var d = byCat[c];
      tbody.appendChild(el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: String(d.rows) }),
        el('td', { class: 'num', text: d.peers > 0 ? String(d.peers) : 'none' }),
        el('td', { class: 'num', text: d.median === null ? 'n/a' : fmtMult(d.median) }),
        el('td', { class: 'num', text: fmtMult(d.applied) })
      ));
    });
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'mini' }, null,
        el('caption', { class: 'sub', text: 'The multiples the snapshot itself carries, per category on the board. A median from few peers is shrunk toward the global median; a category with no tokenized peer is priced at the global median.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Board rows' }), el('th', { scope: 'col', text: 'Tokenized peers' }), el('th', { scope: 'col', text: 'Peer median' }), el('th', { scope: 'col', text: 'Applied' }))),
        tbody
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'No protocol name is special-cased and no row is hand-picked: one function scores every protocol from the snapshot\u2019s own figures. The market prices the board: ' + DATA.peer_count + ' protocols in this snapshot carry both a market cap and a TVL, and the median of them is worth ' + fmtMult(DATA.global_multiple) + ' of its TVL. Each category is priced at its own peers\u2019 median multiple, each peer\u2019s multiple capped at ' + m.peer_cap + 'x before the median, the median shrunk toward the global one with weight peers/(peers + ' + m.shrink_k + ') and clamped to ' + fmtMult(m.multiple_floor) + ' to ' + fmtMult(m.multiple_cap) + ', so a category with one rich peer cannot set its own price.' }),
      el('div', { class: 'formula' },
        'implied = round( TVL x category multiple x (1 + clamp(change_7d, -' + m.growth_clamp + ', +' + m.growth_clamp + ') / 100 x ' + m.growth_weight + ') x (' + m.age_floor + ' + ' + m.age_range + ' x min(age_days, ' + m.age_days_cap + ') / ' + m.age_days_cap + ') )'
      ),
      el('p', { class: 'sub', text: 'Growth is the protocol\u2019s TVL change over seven days, clamped so one hot week moves a value by at most a fifth. Age is the time since the protocol was first tracked, the record of how long it has run with no token; a protocol with no listing date is scored at ' + m.unknown_age_days + ' days. Below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor the board applies the watchlist\u2019s own product rules: exchanges, versioned pools and wrapped, staked or bridged products of tokens that already trade are set aside. ' + DATA.pretoken_size + ' of the snapshot\u2019s ' + DATA.universe_size + ' protocols record no token; the rest already trade and are never ranked.' }),
      categoryTable()
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function basisText(row) {
    if (row.multiple_basis === 'global') return 'No tokenized protocol in this category carries a market cap, so the global median of ' + DATA.peer_count + ' tokenized protocols prices it.';
    if (row.multiple_basis === 'shrunk') return 'The median of ' + row.category_peers + ' tokenized ' + catName(row) + ' peer' + (row.category_peers === 1 ? '' : 's') + ' (' + fmtMult(row.category_median) + '), shrunk toward the global median ' + fmtMult(DATA.global_multiple) + ' because the peer count is small.';
    return 'The median of ' + row.category_peers + ' tokenized ' + catName(row) + ' protocols, lightly shrunk toward the global median ' + fmtMult(DATA.global_multiple) + '.';
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' \u00b7 Watchlist' : ' \u00b7 Early, below the floor') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: catName(row) + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' \u00b7 tracked since ' + row.listed_at : ' \u00b7 no listing date on record') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Growth factor (7d ' + fmtPct(row.change_7d) + ')' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age factor (' + fmtAge(row.age_days) + ' with no token)' }), el('b', { class: 'num', text: fmtMult(row.age_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Implied multiple of TVL' }), el('b', { class: 'num', text: fmtMult(row.implied_value_usd / row.tvl_usd) }))
      ),
      el('p', { class: 'sub', text: basisText(row) }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': this page recomputes the row from the printed factors as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An implied value is an estimate of what a launch could be worth if the record held, not a price and not a prediction that a token comes.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub effort', text: 'Effort: about $' + capital + ' of working capital, roughly 15 minutes a week, held for ' + hold + ' days. Fees depend on the chain: ' + gasFor(chainClass(chainOf(row))) + '.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
