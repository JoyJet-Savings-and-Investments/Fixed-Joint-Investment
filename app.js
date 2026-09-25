/* ============================================================
   City-Coin Investment Dashboard — app.js
   Fully client-side portfolio manager
   ============================================================ */

(() => {
  'use strict';

  /* ===================== CONFIG ===================== */
  const COINS = [
    { symbol: 'BTC', id: 'bitcoin', name: 'Bitcoin' },
    { symbol: 'ETH', id: 'ethereum', name: 'Ethereum' },
    { symbol: 'BNB', id: 'binancecoin', name: 'BNB' },
    { symbol: 'SOL', id: 'solana', name: 'Solana' },
    { symbol: 'XRP', id: 'ripple', name: 'XRP' },
    { symbol: 'ADA', id: 'cardano', name: 'Cardano' },
    { symbol: 'DOGE', id: 'dogecoin', name: 'Dogecoin' },
    { symbol: 'AVAX', id: 'avalanche-2', name: 'Avalanche' },
    { symbol: 'DOT', id: 'polkadot', name: 'Polkadot' },
    { symbol: 'LINK', id: 'chainlink', name: 'Chainlink' }
  ];

  const SYMBOLS = COINS.map(c => c.symbol);
  const ID_MAP = Object.fromEntries(COINS.map(c => [c.symbol, c.id]));
  const STORAGE_KEY = 'citycoin_v4';
  const THEME_KEY = 'citycoin_theme';
  const PRICE_CACHE_KEY = 'citycoin_prices';
  const PRICE_TTL = 55_000; // slightly under 60s interval

  /* ===================== STATE ===================== */
  let appState = loadAppState();
  let prices = {};
  let charts = {};
  let sellTarget = null;
  let priceFetchController = null;

  /* ===================== STORAGE ===================== */
  function emptyHoldings() {
    const h = {};
    SYMBOLS.forEach(s => { h[s] = { units: 0, cost: 0 }; });
    return h;
  }

  function createEmptyPortfolio(name) {
    return {
      name,
      mainBalance: 0,
      holdings: emptyHoldings(),
      realizedPnL: 0,
      transactions: [],
      portfolioHistory: [],
      alerts: []
    };
  }

  function createDemoPortfolio() {
    // Consistent demo seed data
    return {
      name: 'Main Portfolio',
      mainBalance: 4780,
      holdings: {
        BTC: { units: 0.023, cost: 2000 },
        ETH: { units: 0.51, cost: 1500 },
        BNB: { units: 1.19, cost: 1000 },
        SOL: { units: 4.1, cost: 500 },
        XRP: { units: 0, cost: 0 },
        ADA: { units: 0, cost: 0 },
        DOGE: { units: 0, cost: 0 },
        AVAX: { units: 0, cost: 0 },
        DOT: { units: 0, cost: 0 },
        LINK: { units: 0, cost: 0 }
      },
      realizedPnL: 0,
      transactions: [
        { type: 'Invest', detail: 'Invested $150 in BTC (0.0017 units)', amount: 150, date: '2026-08-30' },
        { type: 'Deposit', detail: 'Deposited $150', amount: 150, date: '2026-08-30' },
        { type: 'Invest', detail: 'Invested $300 in ETH (0.102 units)', amount: 300, date: '2026-06-25' },
        { type: 'Deposit', detail: 'Deposited $300', amount: 300, date: '2026-06-25' },
        { type: 'Invest', detail: 'Invested $100 in SOL (0.83 units)', amount: 100, date: '2026-03-13' },
        { type: 'Deposit', detail: 'Deposited $100', amount: 100, date: '2026-03-13' },
        { type: 'Withdraw', detail: 'Withdrew $200', amount: -200, date: '2025-11-03' }
      ],
      // Real progressive history that ends near current total (~9780)
      portfolioHistory: [
        { value: 5000, date: '2025-11' },
        { value: 6200, date: '2025-12' },
        { value: 7100, date: '2026-02' },
        { value: 8500, date: '2026-04' },
        { value: 9200, date: '2026-06' },
        { value: 10500, date: '2026-08' },
        { value: 9780, date: 'Now' }
      ],
      alerts: []
    };
  }

  function loadAppState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate old flat history arrays if present
        Object.values(parsed.portfolios || {}).forEach(p => {
          if (Array.isArray(p.portfolioHistory) && typeof p.portfolioHistory[0] === 'number') {
            p.portfolioHistory = p.portfolioHistory.map((v, i) => ({
              value: v,
              date: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Now'][i] || String(i)
            }));
          }
        });
        return parsed;
      }
    } catch (e) {
      console.warn('Failed to load state', e);
    }
    return {
      activePortfolioId: 'main',
      portfolios: { main: createDemoPortfolio() }
    };
  }

  function saveAppState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
      console.warn('Failed to save state', e);
    }
  }

  function current() {
    return appState.portfolios[appState.activePortfolioId];
  }

  /* ===================== THEME ===================== */
  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
  }

  function updateThemeIcon(theme) {
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeIcon(next);
    updateCharts();
  }

  /* ===================== AUTH (demo) ===================== */
  function isLoggedIn() {
    return document.cookie.includes('loggedIn=true');
  }

  function setLoggedIn(val) {
    document.cookie = val
      ? 'loggedIn=true; max-age=31536000; path=/'
      : 'loggedIn=; max-age=0; path=/';
  }

  /* ===================== HELPERS ===================== */
  function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    el.setAttribute('role', 'status');
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  function formatUSD(n) {
    return '$' + Number(n).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatUnits(n) {
    if (n >= 1) return n.toFixed(4);
    if (n >= 0.01) return n.toFixed(6);
    return n.toFixed(8);
  }

  function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-links a[data-section]').forEach(a => {
      a.classList.toggle('active', a.dataset.section === id);
      if (a.dataset.section === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    // Close mobile menu
    document.getElementById('navLinks')?.classList.remove('open');
  }

  function getPrice(symbol) {
    const id = ID_MAP[symbol];
    return (prices[id] && prices[id].usd) || 0;
  }

  function getCostBasis() {
    return Object.values(current().holdings).reduce((s, h) => s + (h.cost || 0), 0);
  }

  function getMarketValue() {
    return SYMBOLS.reduce((sum, sym) => {
      const h = current().holdings[sym];
      return sum + (h ? h.units * getPrice(sym) : 0);
    }, 0);
  }

  function getTotalValue() {
    return current().mainBalance + getMarketValue();
  }

  function appendHistoryPoint() {
    const p = current();
    const total = getTotalValue();
    const now = new Date();
    const label = now.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    // Keep last 12 points max
    p.portfolioHistory.push({ value: total, date: label });
    if (p.portfolioHistory.length > 12) {
      p.portfolioHistory = p.portfolioHistory.slice(-12);
    }
  }

  /* ===================== MODAL HELPERS ===================== */
  function openModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.add('open');
    // Focus first input
    const firstInput = overlay.querySelector('input, select, button');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function closeModal(id) {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove('open');
  }

  function setupModalEscape() {
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.modal-overlay.open').forEach(m => {
        m.classList.remove('open');
      });
    });
  }

  /* ===================== RENDER ===================== */
  function renderPortfolioSelect() {
    const sel = document.getElementById('portfolioSelect');
    if (!sel) return;
    sel.innerHTML = Object.entries(appState.portfolios)
      .map(([id, p]) =>
        `<option value="${id}" ${id === appState.activePortfolioId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
      )
      .join('');
  }

  function renderBalances() {
    const p = current();
    const cost = getCostBasis();
    const market = getMarketValue();
    const unrealized = market - cost;
    const totalPnL = unrealized + (p.realizedPnL || 0);

    document.getElementById('mainBalance').textContent = formatUSD(p.mainBalance);
    document.getElementById('investedBalance').textContent = formatUSD(cost);
    document.getElementById('marketValue').textContent = formatUSD(market);

    const pnlEl = document.getElementById('totalPnL');
    pnlEl.textContent = formatUSD(totalPnL);
    pnlEl.className = 'value ' + (totalPnL >= 0 ? 'positive' : 'negative');

    const pct = cost > 0 ? (totalPnL / cost * 100) : 0;
    const pctEl = document.getElementById('pnlPercent');
    pctEl.textContent = `${totalPnL >= 0 ? '+' : ''}${pct.toFixed(2)}% (incl. realized)`;
    pctEl.className = 'sub ' + (totalPnL >= 0 ? 'positive' : 'negative');
  }

  function renderPrices() {
    const grid = document.getElementById('priceGrid');
    if (!grid) return;

    if (!Object.keys(prices).length) {
      grid.innerHTML = '<div class="loading-prices">Loading live prices…</div>';
      return;
    }

    grid.innerHTML = COINS.map(c => {
      const p = prices[c.id] || {};
      const change = p.usd_24h_change ?? 0;
      const cls = change >= 0 ? 'positive' : 'negative';
      return `
        <div class="price-item">
          <h4>${c.symbol}</h4>
          <div class="price">${p.usd != null ? formatUSD(p.usd) : '—'}</div>
          <div class="change ${cls}">${change >= 0 ? '+' : ''}${Number(change).toFixed(2)}%</div>
        </div>`;
    }).join('');
  }

  function renderHoldings(filter = '') {
    const body = document.getElementById('holdingsBody');
    if (!body) return;

    const q = filter.trim().toLowerCase();
    const rows = SYMBOLS.filter(sym => {
      if (!q) return true;
      const coin = COINS.find(c => c.symbol === sym);
      return sym.toLowerCase().includes(q) || (coin && coin.name.toLowerCase().includes(q));
    });

    body.innerHTML = rows.map(sym => {
      const h = current().holdings[sym] || { units: 0, cost: 0 };
      const price = getPrice(sym);
      const market = h.units * price;
      const pnl = market - h.cost;
      const pnlCls = pnl >= 0 ? 'positive' : 'negative';
      const has = h.units > 1e-10;
      return `
        <tr>
          <td><strong>${sym}</strong></td>
          <td>${has ? formatUnits(h.units) : '—'}</td>
          <td>${has ? formatUSD(h.cost) : '—'}</td>
          <td>${has ? formatUSD(market) : '—'}</td>
          <td class="${pnlCls}">${has ? formatUSD(pnl) : '—'}</td>
          <td>
            <button class="sell-btn" data-symbol="${sym}" ${!has ? 'disabled' : ''}>Sell</button>
          </td>
        </tr>`;
    }).join('');

    body.querySelectorAll('.sell-btn').forEach(btn => {
      btn.addEventListener('click', () => openSellModal(btn.dataset.symbol));
    });
  }

  function renderTransactions() {
    const list = document.getElementById('txList');
    if (!list) return;

    const txs = current().transactions || [];
    if (!txs.length) {
      list.innerHTML = '<div class="empty-state">No transactions yet</div>';
      return;
    }

    list.innerHTML = txs.map(tx => {
      const typeCls = (tx.type || '').toLowerCase();
      const amountCls = (tx.amount || 0) >= 0 ? 'positive' : 'negative';
      return `
        <div class="tx-item">
          <div class="left">
            <div class="detail">
              <span class="type-badge ${typeCls}">${escapeHtml(tx.type)}</span>
              ${escapeHtml(tx.detail)}
            </div>
          </div>
          <div class="right">
            <div class="amount ${amountCls}">${formatUSD(tx.amount || 0)}</div>
            <div class="date">${escapeHtml(tx.date)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderAlerts() {
    const list = document.getElementById('alertsList');
    if (!list) return;

    const alerts = current().alerts || [];
    if (!alerts.length) {
      list.innerHTML = '<div class="empty-state">No active alerts</div>';
      return;
    }

    list.innerHTML = alerts.map((a, i) => `
      <div class="alert-item">
        <div>
          <strong>${escapeHtml(a.symbol)}</strong>
          ${a.direction === 'above' ? '≥' : '≤'} ${formatUSD(a.price)}
        </div>
        <button class="remove" data-idx="${i}" title="Remove alert" aria-label="Remove alert">×</button>
      </div>
    `).join('');

    list.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        current().alerts.splice(parseInt(btn.dataset.idx, 10), 1);
        saveAppState();
        renderAlerts();
        toast('Alert removed');
      });
    });
  }

  function populateSelects() {
    const opts = COINS.map(c =>
      `<option value="${c.symbol}">${c.name} (${c.symbol})</option>`
    ).join('');
    const cryptoSel = document.getElementById('cryptoSelect');
    const alertSel = document.getElementById('alertSymbol');
    if (cryptoSel) cryptoSel.innerHTML = opts;
    if (alertSel) alertSel.innerHTML = opts;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ===================== CHARTS ===================== */
  function getChartColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      tick: isDark ? '#848e9c' : '#6b7280',
      grid: isDark ? '#2b3139' : '#e1e4e8',
      accent: '#f0b90b'
    };
  }

  function updateCharts() {
    const p = current();
    const market = getMarketValue();
    const total = p.mainBalance + market;
    const colors = getChartColors();

    if (charts.portfolio) {
      const hist = p.portfolioHistory || [];
      // Ensure last point reflects current total
      const data = hist.map(h => (typeof h === 'object' ? h.value : h));
      if (data.length) data[data.length - 1] = total;
      else data.push(total);

      charts.portfolio.data.labels = hist.map(h => (typeof h === 'object' ? h.date : h));
      charts.portfolio.data.datasets[0].data = data;
      charts.portfolio.options.scales.x.ticks.color = colors.tick;
      charts.portfolio.options.scales.y.ticks.color = colors.tick;
      charts.portfolio.options.scales.x.grid.color = colors.grid;
      charts.portfolio.options.scales.y.grid.color = colors.grid;
      charts.portfolio.update('none');
    }

    if (charts.allocation) {
      charts.allocation.data.datasets[0].data =
        SYMBOLS.map(s => (current().holdings[s]?.units || 0) * getPrice(s));
      charts.allocation.options.plugins.legend.labels.color = colors.tick;
      charts.allocation.update('none');
    }

    if (charts.holdings) {
      charts.holdings.data.datasets[0].data =
        SYMBOLS.map(s => (current().holdings[s]?.units || 0) * getPrice(s));
      charts.holdings.options.scales.x.ticks.color = colors.tick;
      charts.holdings.options.scales.y.ticks.color = colors.tick;
      charts.holdings.options.scales.y.grid.color = colors.grid;
      charts.holdings.update('none');
    }
  }

  function initCharts() {
    const colors = getChartColors();
    const common = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: {
          labels: { color: colors.tick, boxWidth: 12, padding: 10 }
        }
      }
    };

    // Portfolio line
    const hist = current().portfolioHistory || [];
    charts.portfolio = new Chart(document.getElementById('portfolioChart'), {
      type: 'line',
      data: {
        labels: hist.map(h => (typeof h === 'object' ? h.date : h)),
        datasets: [{
          label: 'Portfolio',
          data: hist.map(h => (typeof h === 'object' ? h.value : h)),
          borderColor: colors.accent,
          backgroundColor: 'rgba(240,185,11,0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        ...common,
        scales: {
          x: { ticks: { color: colors.tick }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.tick }, grid: { color: colors.grid } }
        }
      }
    });

    // Allocation doughnut
    charts.allocation = new Chart(document.getElementById('allocationChart'), {
      type: 'doughnut',
      data: {
        labels: SYMBOLS,
        datasets: [{
          data: SYMBOLS.map(() => 0),
          backgroundColor: [
            '#f0b90b', '#627eea', '#f3ba2f', '#14f195', '#23292f',
            '#0033ad', '#c2a633', '#e84142', '#e6007a', '#2a5ada'
          ],
          borderWidth: 0
        }]
      },
      options: {
        ...common,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: colors.tick, boxWidth: 10, padding: 8, font: { size: 11 } }
          }
        }
      }
    });

    // Holdings bar
    charts.holdings = new Chart(document.getElementById('holdingsChart'), {
      type: 'bar',
      data: {
        labels: SYMBOLS,
        datasets: [{
          label: 'Value (USD)',
          data: SYMBOLS.map(() => 0),
          backgroundColor: colors.accent,
          borderRadius: 4
        }]
      },
      options: {
        ...common,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: colors.tick, maxRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: colors.tick }, grid: { color: colors.grid } }
        }
      }
    });
  }

  /* ===================== ACTIONS ===================== */
  function addTransaction(type, detail, amount) {
    const today = new Date().toISOString().slice(0, 10);
    current().transactions.unshift({ type, detail, amount, date: today });
    // Cap history length
    if (current().transactions.length > 300) {
      current().transactions = current().transactions.slice(0, 300);
    }
    saveAppState();
    renderTransactions();
  }

  function deposit() {
    openModal('depositModal');
    document.getElementById('depositAmount').value = '';
  }

  function confirmDeposit() {
    const raw = document.getElementById('depositAmount').value;
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) {
      toast('Enter a valid positive amount', 'error');
      return;
    }
    current().mainBalance += val;
    addTransaction('Deposit', `Deposited ${formatUSD(val)}`, val);
    appendHistoryPoint();
    saveAppState();
    closeModal('depositModal');
    renderAll();
    toast(`Deposited ${formatUSD(val)}`);
  }

  function withdraw() {
    openModal('withdrawModal');
  }

  function invest() {
    const symbol = document.getElementById('cryptoSelect').value;
    const amountInput = document.getElementById('investAmount');
    const val = parseFloat(amountInput.value);

    if (!val || val <= 0) {
      toast('Please enter a valid amount', 'error');
      return;
    }
    if (val > current().mainBalance) {
      toast('Insufficient available balance', 'error');
      return;
    }
    const price = getPrice(symbol);
    if (!price) {
      toast('Price not available yet. Please wait a moment.', 'error');
      return;
    }

    const units = val / price;
    const h = current().holdings[symbol];
    h.units += units;
    h.cost += val;
    current().mainBalance -= val;

    addTransaction(
      'Invest',
      `Invested ${formatUSD(val)} in ${symbol} (${formatUnits(units)} units)`,
      val
    );
    appendHistoryPoint();
    saveAppState();
    amountInput.value = '';
    renderAll();
    toast(`Bought ${formatUnits(units)} ${symbol} for ${formatUSD(val)}`);
    showSection('dashboard');
  }

  /* SELL */
  function openSellModal(symbol) {
    const h = current().holdings[symbol];
    if (!h || h.units <= 0) return;
    sellTarget = symbol;
    document.getElementById('sellTitle').textContent = `Sell ${symbol}`;
    document.getElementById('sellPercent').value = '100';
    document.getElementById('sellUnits').value = '';
    document.getElementById('sellMode').value = 'percent';
    toggleSellMode();
    updateSellEstimate();
    openModal('sellModal');
  }

  function toggleSellMode() {
    const mode = document.getElementById('sellMode').value;
    document.getElementById('sellPercentGroup').style.display = mode === 'percent' ? 'block' : 'none';
    document.getElementById('sellUnitsGroup').style.display = mode === 'units' ? 'block' : 'none';
    updateSellEstimate();
  }

  function updateSellEstimate() {
    if (!sellTarget) return;
    const h = current().holdings[sellTarget];
    const price = getPrice(sellTarget);
    let unitsToSell = 0;

    if (document.getElementById('sellMode').value === 'percent') {
      const pct = parseFloat(document.getElementById('sellPercent').value) / 100;
      unitsToSell = h.units * pct;
    } else {
      unitsToSell = parseFloat(document.getElementById('sellUnits').value) || 0;
      if (unitsToSell > h.units) unitsToSell = h.units;
    }

    const proceeds = unitsToSell * price;
    document.getElementById('sellEstimate').textContent = formatUSD(proceeds);
    document.getElementById('sellUnitsInfo').textContent =
      `Available: ${formatUnits(h.units)} · Est. units: ${formatUnits(unitsToSell)}`;
  }

  function confirmSell() {
    if (!sellTarget) return;
    const h = current().holdings[sellTarget];
    let unitsToSell = 0;

    if (document.getElementById('sellMode').value === 'percent') {
      const pct = parseFloat(document.getElementById('sellPercent').value) / 100;
      unitsToSell = h.units * pct;
    } else {
      unitsToSell = parseFloat(document.getElementById('sellUnits').value) || 0;
    }

    if (unitsToSell <= 0 || unitsToSell > h.units + 1e-12) {
      toast('Invalid sell quantity', 'error');
      return;
    }

    const costSold = h.cost * (unitsToSell / h.units);
    const proceeds = unitsToSell * getPrice(sellTarget);
    const pnl = proceeds - costSold;

    h.units -= unitsToSell;
    h.cost -= costSold;
    if (h.units < 1e-10) {
      h.units = 0;
      h.cost = 0;
    }

    current().mainBalance += proceeds;
    current().realizedPnL = (current().realizedPnL || 0) + pnl;

    const sign = pnl >= 0 ? '+' : '';
    addTransaction(
      'Sell',
      `Sold ${formatUnits(unitsToSell)} ${sellTarget} for ${formatUSD(proceeds)} (P&L ${sign}${formatUSD(pnl)})`,
      proceeds
    );
    appendHistoryPoint();
    saveAppState();
    closeModal('sellModal');
    sellTarget = null;
    renderAll();
    toast(`Sold ${sellTarget}: ${formatUSD(proceeds)} (P&L ${sign}${formatUSD(pnl)})`);
  }

  /* PORTFOLIOS */
  function switchPortfolio() {
    appState.activePortfolioId = document.getElementById('portfolioSelect').value;
    saveAppState();
    renderAll();
    toast(`Switched to ${current().name}`);
  }

  function openNewPortfolioModal() {
    document.getElementById('newPortfolioName').value = '';
    openModal('newPortfolioModal');
  }

  function confirmNewPortfolio() {
    const name = document.getElementById('newPortfolioName').value.trim();
    if (!name) {
      toast('Please enter a name', 'error');
      return;
    }
    const id = 'p_' + Date.now();
    appState.portfolios[id] = createEmptyPortfolio(name);
    appState.activePortfolioId = id;
    saveAppState();
    closeModal('newPortfolioModal');
    renderAll();
    toast(`Created portfolio "${name}"`);
  }

  function openRenameModal() {
    document.getElementById('renamePortfolioName').value = current().name;
    openModal('renameModal');
  }

  function confirmRename() {
    const name = document.getElementById('renamePortfolioName').value.trim();
    if (!name) {
      toast('Please enter a name', 'error');
      return;
    }
    current().name = name;
    saveAppState();
    closeModal('renameModal');
    renderPortfolioSelect();
    toast('Portfolio renamed');
  }

  /* ALERTS */
  function addAlert() {
    const symbol = document.getElementById('alertSymbol').value;
    const price = parseFloat(document.getElementById('alertPrice').value);
    const direction = document.getElementById('alertDirection').value;

    if (!price || price <= 0) {
      toast('Enter a valid target price', 'error');
      return;
    }
    if (!current().alerts) current().alerts = [];
    current().alerts.push({ symbol, price, direction, id: Date.now() });
    saveAppState();
    document.getElementById('alertPrice').value = '';
    renderAlerts();
    toast(`Alert set: ${symbol} ${direction === 'above' ? '≥' : '≤'} ${formatUSD(price)}`);
  }

  function checkAlerts() {
    const alerts = current().alerts || [];
    const remaining = [];
    alerts.forEach(a => {
      const cur = getPrice(a.symbol);
      if (!cur) {
        remaining.push(a);
        return;
      }
      const triggered = a.direction === 'above' ? cur >= a.price : cur <= a.price;
      if (triggered) {
        toast(`ALERT: ${a.symbol} is now ${formatUSD(cur)} (target ${formatUSD(a.price)})`, 'alert');
      } else {
        remaining.push(a);
      }
    });
    if (remaining.length !== alerts.length) {
      current().alerts = remaining;
      saveAppState();
      renderAlerts();
    }
  }

  /* CSV + CLEAR */
  function exportCSV() {
    const txs = current().transactions;
    if (!txs.length) {
      toast('No transactions to export', 'error');
      return;
    }
    const header = 'Date,Type,Detail,Amount\n';
    const rows = txs.map(t =>
      `"${t.date}","${t.type}","${(t.detail || '').replace(/"/g, '""')}",${t.amount}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `citycoin-${current().name.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported successfully');
  }

  function clearHistory() {
    if (!current().transactions.length) {
      toast('History is already empty', 'error');
      return;
    }
    openModal('clearHistoryModal');
  }

  function confirmClearHistory() {
    current().transactions = [];
    saveAppState();
    closeModal('clearHistoryModal');
    renderTransactions();
    toast('Transaction history cleared');
  }

  function renderAll() {
    renderPortfolioSelect();
    renderBalances();
    renderPrices();
    renderHoldings(document.getElementById('holdingsSearch')?.value || '');
    renderTransactions();
    renderAlerts();
    updateCharts();
  }

  /* ===================== PRICES ===================== */
  async function fetchPrices() {
    // Cancel previous request if still pending
    if (priceFetchController) {
      priceFetchController.abort();
    }
    priceFetchController = new AbortController();

    // Try cache first
    try {
      const cached = localStorage.getItem(PRICE_CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < PRICE_TTL) {
          prices = data;
          renderPrices();
          renderHoldings(document.getElementById('holdingsSearch')?.value || '');
          renderBalances();
          updateCharts();
          checkAlerts();
          return;
        }
      }
    } catch (_) {}

    try {
      const ids = COINS.map(c => c.id).join(',');
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { signal: priceFetchController.signal }
      );
      if (!res.ok) throw new Error('API error ' + res.status);
      prices = await res.json();
      localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ data: prices, ts: Date.now() }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('Price fetch failed, using fallback', e);
      // Static fallback so the app remains usable offline
      prices = {
        bitcoin: { usd: 86979, usd_24h_change: 1.2 },
        ethereum: { usd: 2926, usd_24h_change: -0.8 },
        binancecoin: { usd: 837, usd_24h_change: 0.5 },
        solana: { usd: 121, usd_24h_change: 2.1 },
        ripple: { usd: 0.58, usd_24h_change: 0.3 },
        cardano: { usd: 0.42, usd_24h_change: -1.1 },
        dogecoin: { usd: 0.12, usd_24h_change: 3.4 },
        'avalanche-2': { usd: 28.5, usd_24h_change: 1.8 },
        polkadot: { usd: 6.2, usd_24h_change: -0.5 },
        chainlink: { usd: 14.8, usd_24h_change: 0.9 }
      };
    }

    renderPrices();
    renderHoldings(document.getElementById('holdingsSearch')?.value || '');
    renderBalances();
    updateCharts();
    checkAlerts();
  }

  /* ===================== INIT ===================== */
  function startApp() {
    closeModal('loginModal');
    document.getElementById('app').classList.add('visible');
    document.querySelector('footer')?.classList.add('visible');
    populateSelects();
    initCharts();
    renderAll();
    fetchPrices();
    setInterval(fetchPrices, 60_000);
  }

  function bindEvents() {
    // Login
    document.getElementById('loginBtn')?.addEventListener('click', () => {
      const email = document.getElementById('email').value.trim();
      const pass = document.getElementById('password').value;
      const err = document.getElementById('loginError');
      // Demo credentials (kept for compatibility, not shown in UI)
      if (email === 'indiavvs767@gmail.com' && pass === 'pizza') {
        setLoggedIn(true);
        err.textContent = '';
        startApp();
      } else {
        err.textContent = 'Invalid email or password';
      }
    });

    document.getElementById('password')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('loginBtn')?.click();
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      setLoggedIn(false);
      location.reload();
    });

    // Theme
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

    // Nav
    document.getElementById('hamburger')?.addEventListener('click', () => {
      const links = document.getElementById('navLinks');
      const btn = document.getElementById('hamburger');
      const isOpen = links?.classList.toggle('open');
      if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.querySelectorAll('[data-section]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        if (el.dataset.section) showSection(el.dataset.section);
      });
    });

    // Portfolio
    document.getElementById('portfolioSelect')?.addEventListener('change', switchPortfolio);
    document.getElementById('newPortfolioBtn')?.addEventListener('click', openNewPortfolioModal);
    document.getElementById('renamePortfolioBtn')?.addEventListener('click', openRenameModal);
    document.getElementById('confirmNewPortfolio')?.addEventListener('click', confirmNewPortfolio);
    document.getElementById('confirmRename')?.addEventListener('click', confirmRename);

    // Deposit / Withdraw
    document.getElementById('depositBtn')?.addEventListener('click', deposit);
    document.getElementById('confirmDeposit')?.addEventListener('click', confirmDeposit);
    document.getElementById('withdrawBtn')?.addEventListener('click', withdraw);
    document.getElementById('closeWithdrawModal')?.addEventListener('click', () => closeModal('withdrawModal'));

    // Invest
    document.getElementById('investBtn')?.addEventListener('click', invest);

    // Sell
    document.getElementById('sellMode')?.addEventListener('change', toggleSellMode);
    document.getElementById('sellPercent')?.addEventListener('change', updateSellEstimate);
    document.getElementById('sellUnits')?.addEventListener('input', updateSellEstimate);
    document.getElementById('confirmSellBtn')?.addEventListener('click', confirmSell);
    document.getElementById('cancelSellBtn')?.addEventListener('click', () => {
      closeModal('sellModal');
      sellTarget = null;
    });

    // Alerts
    document.getElementById('addAlertBtn')?.addEventListener('click', addAlert);

    // History
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);
    document.getElementById('exportCsvBtnHistory')?.addEventListener('click', exportCSV);
    document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);
    document.getElementById('confirmClearHistory')?.addEventListener('click', confirmClearHistory);
    document.getElementById('cancelClearHistory')?.addEventListener('click', () => closeModal('clearHistoryModal'));

    // Holdings search
    document.getElementById('holdingsSearch')?.addEventListener('input', e => {
      renderHoldings(e.target.value);
    });

    // Modal cancel buttons (generic)
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    setupModalEscape();
  }

  // Boot
  initTheme();
  bindEvents();
  if (isLoggedIn()) {
    startApp();
  } else {
    openModal('loginModal');
  }
})();
