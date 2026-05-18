// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const ROW_HEIGHT = 28;
  const HISTORY_MAX = 50;
  const VIRTUAL_ROW_BUFFER = 3;

  const state = {
    headers: ['Column 1'],
    rows: [['']],
    delimiter: ',',
    hasHeader: true,
    delimiterLabel: 'comma',
    encoding: 'utf8',
    maxRowsBeforeVirtualScroll: 5000,
    modified: false,
    dirtyCells: new Set(),
    filters: [],
    filterVisible: false,
    sortCol: -1,
    sortDir: 0,
    hiddenCols: new Set(),
    selection: { anchor: null, focus: null },
    selectedRows: new Set(),
    editing: null,
    history: [],
    historyIndex: -1,
    findOpen: false,
    findQuery: '',
    findReplace: '',
    findOptions: { caseSensitive: false, regex: false, wholeCell: false },
    findHits: [],
    findIndex: -1,
    virtualEnabled: false,
    virtualStart: 0,
    virtualEnd: 0,
  };

  const $ = (id) => document.getElementById(id);

  function serializeField(value, delimiter) {
    const needs =
      value.includes(delimiter) ||
      value.includes('"') ||
      value.includes('\n') ||
      value.includes('\r');
    return needs ? `"${value.replace(/"/g, '""')}"` : value;
  }

  function serializeCsv() {
    const lines = [];
    if (state.hasHeader) {
      lines.push(state.headers.map((c) => serializeField(c, state.delimiter)).join(state.delimiter));
    }
    for (const row of state.rows) {
      const cells = state.headers.map((_, i) => serializeField(row[i] ?? '', state.delimiter));
      lines.push(cells.join(state.delimiter));
    }
    return lines.join('\n') + '\n';
  }

  let syncTimer = null;
  function scheduleSync() {
    state.modified = true;
    updateStatus();
    if (syncTimer) {
      clearTimeout(syncTimer);
    }
    syncTimer = setTimeout(() => {
      vscode.postMessage({ type: 'documentChanged', csv: serializeCsv() });
    }, 300);
  }

  function snapshot() {
    return {
      headers: state.headers.slice(),
      rows: state.rows.map((r) => r.slice()),
    };
  }

  function pushHistory() {
    const snap = snapshot();
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snap);
    if (state.history.length > HISTORY_MAX) {
      state.history.shift();
    } else {
      state.historyIndex++;
    }
  }

  function restoreHistory(index) {
    const snap = state.history[index];
    if (!snap) {
      return;
    }
    state.headers = snap.headers.slice();
    state.rows = snap.rows.map((r) => r.slice());
    state.historyIndex = index;
    renderAll();
    scheduleSync();
  }

  function undo() {
    if (state.historyIndex > 0) {
      restoreHistory(state.historyIndex - 1);
    }
  }

  function redo() {
    if (state.historyIndex < state.history.length - 1) {
      restoreHistory(state.historyIndex + 1);
    }
  }

  function visibleRowIndices() {
    const indices = [];
    for (let r = 0; r < state.rows.length; r++) {
      if (rowPassesFilter(r)) {
        indices.push(r);
      }
    }
    return indices;
  }

  function rowPassesFilter(rowIndex) {
    if (!state.filterVisible || state.filters.every((f) => !f)) {
      return true;
    }
    const row = state.rows[rowIndex];
    for (let c = 0; c < state.headers.length; c++) {
      const f = state.filters[c];
      if (!f) {
        continue;
      }
      const val = (row[c] ?? '').toLowerCase();
      if (!val.includes(f.toLowerCase())) {
        return false;
      }
    }
    return true;
  }

  function renderToolbar() {
    const tb = $('toolbar');
    if (!tb) {
      return;
    }
    const buttons = [
      ['+ Row', 'addRow'],
      ['+ Column', 'addColumn'],
      ['Delete Row', 'deleteRow'],
      ['Delete Column', 'deleteColumn'],
      '|',
      ['Sort ▲', 'sortAsc'],
      ['Sort ▼', 'sortDesc'],
      ['Filter', 'toggleFilter'],
      ['Undo', 'undo'],
      ['Redo', 'redo'],
      '|',
      ['Find & Replace', 'toggleFind'],
      '|',
      ['Export CSV', 'exportCsv'],
      ['Export JSON', 'exportJson'],
      ['Export TSV', 'exportTsv'],
    ];
    tb.innerHTML = '';
    for (const [label, action] of buttons) {
      if (action === '|') {
        const sep = document.createElement('span');
        sep.className = 'sep';
        tb.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.action = action;
      btn.addEventListener('click', () => handleAction(action));
      tb.appendChild(btn);
    }
  }

  function renderFilterBar() {
    const bar = $('filter-bar');
    if (!bar) {
      return;
    }
    bar.classList.toggle('hidden', !state.filterVisible);
    if (!state.filterVisible) {
      return;
    }
    bar.innerHTML = '';
    const corner = document.createElement('span');
    corner.textContent = 'Filter';
    corner.style.minWidth = '42px';
    corner.style.fontSize = '11px';
    bar.appendChild(corner);
    state.filters = state.filters.length ? state.filters : state.headers.map(() => '');
    for (let c = 0; c < state.headers.length; c++) {
      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = state.headers[c];
      input.value = state.filters[c] ?? '';
      input.addEventListener('input', () => {
        state.filters[c] = input.value;
        renderGridBody();
        updateStatus();
      });
      bar.appendChild(input);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear all';
    clear.className = 'secondary';
    clear.addEventListener('click', () => {
      state.filters = state.headers.map(() => '');
      renderFilterBar();
      renderGridBody();
    });
    bar.appendChild(clear);
  }

  function renderGridHead() {
    const head = $('grid-head');
    if (!head) {
      return;
    }
    head.innerHTML = '';
    const tr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner row-num';
    corner.textContent = '#';
    tr.appendChild(corner);
    state.headers.forEach((h, col) => {
      if (state.hiddenCols.has(col)) {
        return;
      }
      const th = document.createElement('th');
      th.dataset.col = String(col);
      const label = document.createElement('span');
      label.textContent = h || `Column ${col + 1}`;
      th.appendChild(label);
      if (state.sortCol === col) {
        const ind = document.createElement('span');
        ind.className = 'sort-indicator';
        ind.textContent = state.sortDir > 0 ? '▲' : '▼';
        th.appendChild(ind);
      }
      th.addEventListener('click', () => cycleSort(col));
      th.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const name = prompt('Column name', h);
        if (name !== null) {
          pushHistory();
          state.headers[col] = name;
          renderAll();
          scheduleSync();
        }
      });
      th.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showColumnMenu(e, col);
      });
      tr.appendChild(th);
    });
    head.appendChild(tr);
  }

  function cycleSort(col) {
    pushHistory();
    if (state.sortCol !== col) {
      state.sortCol = col;
      state.sortDir = 1;
    } else if (state.sortDir === 1) {
      state.sortDir = -1;
    } else {
      state.sortCol = -1;
      state.sortDir = 0;
    }
    if (state.sortDir !== 0) {
      state.rows.sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        return state.sortDir * cmp;
      });
      scheduleSync();
    }
    renderAll();
  }

  function renderGridBody() {
    const body = $('grid-body');
    const scroll = $('grid-scroll');
    if (!body || !scroll) {
      return;
    }
    const visible = visibleRowIndices();
    state.virtualEnabled = visible.length > state.maxRowsBeforeVirtualScroll;

    let start = 0;
    let end = visible.length;
    if (state.virtualEnabled) {
      const scrollTop = scroll.scrollTop;
      const viewH = scroll.clientHeight;
      start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_ROW_BUFFER);
      end = Math.min(
        visible.length,
        Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + VIRTUAL_ROW_BUFFER
      );
    }
    state.virtualStart = start;
    state.virtualEnd = end;

    const topSpacer = $('virtual-top');
    const bottomSpacer = $('virtual-bottom');
    if (topSpacer) {
      topSpacer.style.height = state.virtualEnabled ? `${start * ROW_HEIGHT}px` : '0';
    }
    if (bottomSpacer) {
      bottomSpacer.style.height = state.virtualEnabled
        ? `${(visible.length - end) * ROW_HEIGHT}px`
        : '0';
    }

    body.innerHTML = '';
    for (let vi = start; vi < end; vi++) {
      const rowIndex = visible[vi];
      const tr = document.createElement('tr');
      if (state.selectedRows.has(rowIndex)) {
        tr.classList.add('selected-row');
      }
      const rn = document.createElement('td');
      rn.className = 'row-num';
      rn.textContent = String(rowIndex + 1);
      rn.addEventListener('click', (e) => {
        if (e.shiftKey && state.selection.anchor !== null) {
          const from = Math.min(state.selection.anchor.row, rowIndex);
          const to = Math.max(state.selection.anchor.row, rowIndex);
          state.selectedRows.clear();
          for (let i = from; i <= to; i++) {
            state.selectedRows.add(i);
          }
        } else {
          state.selectedRows.clear();
          state.selectedRows.add(rowIndex);
        }
        renderGridBody();
      });
      rn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!state.selectedRows.has(rowIndex)) {
          state.selectedRows.clear();
          state.selectedRows.add(rowIndex);
        }
        showRowMenu(e, rowIndex);
      });
      tr.appendChild(rn);

      state.headers.forEach((_, col) => {
        if (state.hiddenCols.has(col)) {
          return;
        }
        const td = document.createElement('td');
        const key = `${rowIndex}:${col}`;
        if (isSelected(rowIndex, col)) {
          td.classList.add('selected');
        }
        if (state.dirtyCells.has(key)) {
          td.classList.add('dirty');
        }
        if (state.findHits.some((h) => h.row === rowIndex && h.col === col)) {
          td.classList.add('find-hit');
        }

        const editing =
          state.editing && state.editing.row === rowIndex && state.editing.col === col;

        if (editing) {
          const input = document.createElement('input');
          input.className = 'cell-input';
          input.value = state.rows[rowIndex][col] ?? '';
          input.addEventListener('blur', () => commitEdit(input.value));
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              commitEdit(input.value);
              moveEdit(0, ev.shiftKey ? -1 : 1);
            } else if (ev.key === 'Tab') {
              ev.preventDefault();
              commitEdit(input.value);
              moveEdit(ev.shiftKey ? -1 : 1, 0);
            } else if (ev.key === 'Escape') {
              state.editing = null;
              renderGridBody();
            }
          });
          td.appendChild(input);
          setTimeout(() => input.focus(), 0);
        } else {
          const div = document.createElement('div');
          div.className = 'cell';
          div.textContent = state.rows[rowIndex][col] ?? '';
          div.addEventListener('click', (e) => {
            handleCellClick(rowIndex, col, e);
          });
          div.addEventListener('dblclick', () => startEdit(rowIndex, col));
          td.appendChild(div);
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
  }

  function isSelected(row, col) {
    const { anchor, focus } = state.selection;
    if (!anchor || !focus) {
      return false;
    }
    const r0 = Math.min(anchor.row, focus.row);
    const r1 = Math.max(anchor.row, focus.row);
    const c0 = Math.min(anchor.col, focus.col);
    const c1 = Math.max(anchor.col, focus.col);
    return row >= r0 && row <= r1 && col >= c0 && col <= c1;
  }

  function handleCellClick(row, col, e) {
    if (e.ctrlKey || e.metaKey) {
      state.selection.focus = { row, col };
    } else if (e.shiftKey && state.selection.anchor) {
      state.selection.focus = { row, col };
    } else {
      state.selection.anchor = { row, col };
      state.selection.focus = { row, col };
    }
    renderGridBody();
  }

  function startEdit(row, col) {
    state.editing = { row, col };
    renderGridBody();
  }

  function commitEdit(value) {
    if (!state.editing) {
      return;
    }
    const { row, col } = state.editing;
    const prev = state.rows[row][col] ?? '';
    if (prev !== value) {
      pushHistory();
      state.rows[row][col] = value;
      state.dirtyCells.add(`${row}:${col}`);
      scheduleSync();
    }
    state.editing = null;
  }

  function moveEdit(dCol, dRow) {
    if (!state.editing) {
      return;
    }
    let { row, col } = state.editing;
    col += dCol;
    row += dRow;
    col = Math.max(0, Math.min(state.headers.length - 1, col));
    row = Math.max(0, Math.min(state.rows.length - 1, row));
    state.editing = { row, col };
    renderGridBody();
  }

  function renderAll() {
    ensureRowWidths();
    renderToolbar();
    renderFilterBar();
    renderGridHead();
    renderGridBody();
    renderFindPanel();
    updateStatus();
  }

  function ensureRowWidths() {
    for (const row of state.rows) {
      while (row.length < state.headers.length) {
        row.push('');
      }
    }
  }

  function updateStatus() {
    const bar = $('status-bar');
    if (!bar) {
      return;
    }
    const sel = selectionSize();
    bar.innerHTML = [
      `<span>Rows: ${state.rows.length}</span>`,
      `<span>Columns: ${state.headers.length}</span>`,
      `<span>Selected: ${sel.rows}×${sel.cols}</span>`,
      `<span>Delimiter: ${state.delimiterLabel}</span>`,
      `<span>Encoding: ${state.encoding.toUpperCase()}</span>`,
      state.modified ? '<span class="modified">Modified ●</span>' : '<span>Saved</span>',
    ].join('');
  }

  function selectionSize() {
    const { anchor, focus } = state.selection;
    if (!anchor || !focus) {
      return { rows: 0, cols: 0 };
    }
    return {
      rows: Math.abs(focus.row - anchor.row) + 1,
      cols: Math.abs(focus.col - anchor.col) + 1,
    };
  }

  function handleAction(action) {
    switch (action) {
      case 'addRow':
        pushHistory();
        state.rows.push(state.headers.map(() => ''));
        scheduleSync();
        renderAll();
        break;
      case 'addColumn': {
        const name = prompt('Column name', `Column ${state.headers.length + 1}`);
        if (name === null) {
          return;
        }
        pushHistory();
        state.headers.push(name);
        state.rows.forEach((r) => r.push(''));
        scheduleSync();
        renderAll();
        break;
      }
      case 'deleteRow': {
        const targets =
          state.selectedRows.size > 0
            ? [...state.selectedRows].sort((a, b) => b - a)
            : state.rows.length
              ? [state.rows.length - 1]
              : [];
        if (!targets.length) {
          return;
        }
        pushHistory();
        for (const i of targets) {
          state.rows.splice(i, 1);
        }
        if (!state.rows.length) {
          state.rows.push(state.headers.map(() => ''));
        }
        state.selectedRows.clear();
        scheduleSync();
        renderAll();
        break;
      }
      case 'deleteColumn': {
        const col = state.selection.focus?.col ?? state.headers.length - 1;
        if (state.headers.length <= 1) {
          return;
        }
        pushHistory();
        state.headers.splice(col, 1);
        state.rows.forEach((r) => r.splice(col, 1));
        scheduleSync();
        renderAll();
        break;
      }
      case 'sortAsc':
        if (state.selection.focus) {
          state.sortCol = state.selection.focus.col;
          state.sortDir = 1;
          cycleSort(state.sortCol);
          state.sortDir = 1;
        }
        break;
      case 'sortDesc':
        if (state.selection.focus) {
          state.sortCol = state.selection.focus.col;
          state.sortDir = -1;
          state.rows.sort((a, b) => {
            const cmp = (a[state.sortCol] ?? '').localeCompare(b[state.sortCol] ?? '', undefined, {
              numeric: true,
            });
            return -cmp;
          });
          scheduleSync();
          renderAll();
        }
        break;
      case 'toggleFilter':
        state.filterVisible = !state.filterVisible;
        renderFilterBar();
        renderGridBody();
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'toggleFind':
        state.findOpen = !state.findOpen;
        renderFindPanel();
        break;
      case 'exportCsv':
        scheduleSync();
        vscode.postMessage({ type: 'documentChanged', csv: serializeCsv() });
        break;
      case 'exportJson':
        vscode.postMessage({
          type: 'exportJson',
          headers: state.headers,
          rows: state.rows,
        });
        break;
      case 'exportTsv':
        vscode.postMessage({
          type: 'exportTsvRequest',
          headers: state.headers,
          rows: state.rows,
          hasHeader: state.hasHeader,
        });
        break;
      case 'reload':
        vscode.postMessage({ type: 'ready' });
        break;
      default:
        break;
    }
  }

  function renderFindPanel() {
    const panel = $('find-panel');
    if (!panel) {
      return;
    }
    panel.classList.toggle('hidden', !state.findOpen);
    if (!state.findOpen) {
      return;
    }
    panel.innerHTML = `
      <strong>Find & Replace</strong>
      <label>Find<input type="text" id="find-q" value="${escapeAttr(state.findQuery)}" /></label>
      <label>Replace<input type="text" id="find-r" value="${escapeAttr(state.findReplace)}" /></label>
      <label><input type="checkbox" id="find-case" ${state.findOptions.caseSensitive ? 'checked' : ''}/> Case sensitive</label>
      <label><input type="checkbox" id="find-regex" ${state.findOptions.regex ? 'checked' : ''}/> Regex</label>
      <label><input type="checkbox" id="find-whole" ${state.findOptions.wholeCell ? 'checked' : ''}/> Whole cell</label>
      <div class="row">
        <button type="button" id="find-prev">Previous</button>
        <button type="button" id="find-next">Next</button>
      </div>
      <div class="row">
        <button type="button" id="find-replace">Replace</button>
        <button type="button" id="find-replace-all">Replace all</button>
      </div>
      <button type="button" id="find-close">Close</button>
    `;

    $('find-q')?.addEventListener('input', (e) => {
      state.findQuery = /** @type {HTMLInputElement} */ (e.target).value;
      runFind();
    });
    $('find-r')?.addEventListener('input', (e) => {
      state.findReplace = /** @type {HTMLInputElement} */ (e.target).value;
    });
    $('find-case')?.addEventListener('change', (e) => {
      state.findOptions.caseSensitive = /** @type {HTMLInputElement} */ (e.target).checked;
      runFind();
    });
    $('find-regex')?.addEventListener('change', (e) => {
      state.findOptions.regex = /** @type {HTMLInputElement} */ (e.target).checked;
      runFind();
    });
    $('find-whole')?.addEventListener('change', (e) => {
      state.findOptions.wholeCell = /** @type {HTMLInputElement} */ (e.target).checked;
      runFind();
    });
    $('find-next')?.addEventListener('click', () => stepFind(1));
    $('find-prev')?.addEventListener('click', () => stepFind(-1));
    $('find-replace')?.addEventListener('click', () => replaceOne());
    $('find-replace-all')?.addEventListener('click', () => replaceAll());
    $('find-close')?.addEventListener('click', () => {
      state.findOpen = false;
      renderFindPanel();
    });
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  function runFind() {
    state.findHits = [];
    const q = state.findQuery;
    if (!q) {
      renderGridBody();
      return;
    }
    let re;
    try {
      if (state.findOptions.regex) {
        re = new RegExp(q, state.findOptions.caseSensitive ? 'g' : 'gi');
      }
    } catch {
      return;
    }
    for (let r = 0; r < state.rows.length; r++) {
      for (let c = 0; c < state.headers.length; c++) {
        const val = state.rows[r][c] ?? '';
        let match = false;
        if (state.findOptions.regex && re) {
          match = re.test(val);
          re.lastIndex = 0;
        } else {
          const hay = state.findOptions.caseSensitive ? val : val.toLowerCase();
          const needle = state.findOptions.caseSensitive ? q : q.toLowerCase();
          match = state.findOptions.wholeCell ? hay === needle : hay.includes(needle);
        }
        if (match) {
          state.findHits.push({ row: r, col: c });
        }
      }
    }
    state.findIndex = state.findHits.length ? 0 : -1;
    focusFindHit();
    renderGridBody();
  }

  function stepFind(dir) {
    if (!state.findHits.length) {
      runFind();
    }
    if (!state.findHits.length) {
      return;
    }
    state.findIndex = (state.findIndex + dir + state.findHits.length) % state.findHits.length;
    focusFindHit();
    renderGridBody();
  }

  function focusFindHit() {
    const hit = state.findHits[state.findIndex];
    if (!hit) {
      return;
    }
    state.selection.anchor = { row: hit.row, col: hit.col };
    state.selection.focus = { row: hit.row, col: hit.col };
  }

  function replaceOne() {
    const hit = state.findHits[state.findIndex];
    if (!hit) {
      return;
    }
    pushHistory();
    state.rows[hit.row][hit.col] = applyReplace(state.rows[hit.row][hit.col] ?? '');
    scheduleSync();
    runFind();
  }

  function replaceAll() {
    if (!state.findQuery) {
      return;
    }
    pushHistory();
    for (let r = 0; r < state.rows.length; r++) {
      for (let c = 0; c < state.headers.length; c++) {
        state.rows[r][c] = applyReplace(state.rows[r][c] ?? '', true);
      }
    }
    scheduleSync();
    runFind();
    renderAll();
  }

  function applyReplace(val, global) {
    const q = state.findQuery;
    const rep = state.findReplace;
    if (state.findOptions.regex) {
      try {
        const re = new RegExp(q, global ? (state.findOptions.caseSensitive ? 'g' : 'gi') : '');
        return val.replace(re, rep);
      } catch {
        return val;
      }
    }
    if (state.findOptions.wholeCell && val === q) {
      return rep;
    }
    if (state.findOptions.caseSensitive) {
      return global ? val.split(q).join(rep) : val.replace(q, rep);
    }
    const re = new RegExp(escapeRegex(q), global ? 'gi' : 'i');
    return val.replace(re, rep);
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function showColumnMenu(e, col) {
    showMenu(e.clientX, e.clientY, [
      ['Sort A→Z', () => {
        state.sortCol = col;
        state.sortDir = 1;
        cycleSort(col);
      }],
      ['Sort Z→A', () => {
        state.sortCol = col;
        state.sortDir = -1;
        cycleSort(col);
      }],
      ['Insert column left', () => insertColumn(col)],
      ['Insert column right', () => insertColumn(col + 1)],
      ['Delete column', () => {
        state.selection.focus = { row: 0, col };
        handleAction('deleteColumn');
      }],
      ['Hide column', () => {
        state.hiddenCols.add(col);
        renderAll();
      }],
    ]);
  }

  function insertColumn(at) {
    pushHistory();
    state.headers.splice(at, 0, `Column ${at + 1}`);
    state.rows.forEach((r) => r.splice(at, 0, ''));
    scheduleSync();
    renderAll();
  }

  function showRowMenu(e, row) {
    showMenu(e.clientX, e.clientY, [
      ['Insert row above', () => insertRow(row)],
      ['Insert row below', () => insertRow(row + 1)],
      ['Delete row', () => {
        state.selectedRows.clear();
        state.selectedRows.add(row);
        handleAction('deleteRow');
      }],
      ['Duplicate row', () => {
        pushHistory();
        state.rows.splice(row + 1, 0, state.rows[row].slice());
        scheduleSync();
        renderAll();
      }],
    ]);
  }

  function insertRow(at) {
    pushHistory();
    state.rows.splice(at, 0, state.headers.map(() => ''));
    scheduleSync();
    renderAll();
  }

  let menuEl = null;
  function showMenu(x, y, items) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'context-menu';
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
    for (const [label, fn] of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        closeMenu();
        fn();
      });
      menuEl.appendChild(btn);
    }
    document.body.appendChild(menuEl);
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }

  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }

  function initFromHost(data) {
    state.headers = data.headers?.length ? data.headers.slice() : ['Column 1'];
    state.rows = data.rows?.length ? data.rows.map((r) => r.slice()) : [['']];
    state.delimiter = data.delimiter ?? ',';
    state.hasHeader = data.hasHeader ?? true;
    state.delimiterLabel = data.delimiterLabel ?? 'comma';
    state.encoding = data.encoding ?? 'utf8';
    state.maxRowsBeforeVirtualScroll = data.maxRowsBeforeVirtualScroll ?? 5000;
    state.modified = !!data.isDirty;
    state.dirtyCells.clear();
    state.filters = state.headers.map(() => '');
    state.history = [snapshot()];
    state.historyIndex = 0;
    renderAll();
  }

  $('grid-scroll')?.addEventListener('scroll', () => {
    if (state.virtualEnabled) {
      renderGridBody();
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      state.selection.anchor = { row: 0, col: 0 };
      state.selection.focus = {
        row: state.rows.length - 1,
        col: state.headers.length - 1,
      };
      renderGridBody();
    } else if (e.key === 'Delete' && state.selection.anchor) {
      pushHistory();
      const { anchor, focus } = state.selection;
      const r0 = Math.min(anchor.row, focus.row);
      const r1 = Math.max(anchor.row, focus.row);
      const c0 = Math.min(anchor.col, focus.col);
      const c1 = Math.max(anchor.col, focus.col);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          state.rows[r][c] = '';
          state.dirtyCells.add(`${r}:${c}`);
        }
      }
      scheduleSync();
      renderGridBody();
    }
  });

  document.addEventListener('copy', (e) => {
    const text = copySelection();
    if (text && e.clipboardData) {
      e.preventDefault();
      e.clipboardData.setData('text/plain', text);
    }
  });

  document.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (!text || !state.selection.anchor) {
      return;
    }
    e.preventDefault();
    pushHistory();
    pasteTsv(text, state.selection.anchor.row, state.selection.anchor.col);
    scheduleSync();
    renderAll();
  });

  function copySelection() {
    const { anchor, focus } = state.selection;
    if (!anchor || !focus) {
      return '';
    }
    const r0 = Math.min(anchor.row, focus.row);
    const r1 = Math.max(anchor.row, focus.row);
    const c0 = Math.min(anchor.col, focus.col);
    const c1 = Math.max(anchor.col, focus.col);
    const lines = [];
    for (let r = r0; r <= r1; r++) {
      const cells = [];
      for (let c = c0; c <= c1; c++) {
        cells.push(state.rows[r][c] ?? '');
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  function pasteTsv(text, startRow, startCol) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
    for (let r = 0; r < lines.length; r++) {
      const cells = lines[r].split('\t');
      const rowIndex = startRow + r;
      while (state.rows.length <= rowIndex) {
        state.rows.push(state.headers.map(() => ''));
      }
      for (let c = 0; c < cells.length; c++) {
        const colIndex = startCol + c;
        while (state.headers.length <= colIndex) {
          state.headers.push(`Column ${state.headers.length + 1}`);
          state.rows.forEach((row) => row.push(''));
        }
        state.rows[rowIndex][colIndex] = cells[c];
      }
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
      case 'reload':
        initFromHost(msg.data ?? msg);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'command':
        if (msg.action) {
          handleAction(msg.action);
        }
        break;
      default:
        break;
    }
  });

  renderToolbar();
  vscode.postMessage({ type: 'ready' });
})();
