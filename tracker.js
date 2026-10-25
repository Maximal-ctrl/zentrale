// Ideen- und Gewohnheiten-Tracker der Zentrale
//
// Beide funktionieren wie der Kalender: kleines Kästchen unten, beim Hovern größer mit Vorschau,
// Klick öffnet die große Ansicht (#ideen bzw. #gewohnheiten), Home oder Klick daneben schließt sie.
// Gespeichert wird in ideen.json und gewohnheiten.json im Projektordner.
//
// Nutzt von der Hauptseite: berlinStamp, addDays, dateFromIso, daysBetween, openView, CATEGORY_COLORS
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const todayIso = () => berlinStamp(new Date()).date;
  const dateLabel = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  const weekdayLabel = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'short' });

  // Kleiner Helfer zum Bauen von Elementen
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'style') Object.assign(node.style, value);
      else if (key.startsWith('--')) node.style.setProperty(key, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
    return node;
  }

  // Laden/Speichern über den Server; Speichern kurz verzögert, damit Tippen nicht jede Taste schickt
  function createStore(url, emptyValue) {
    let timer = null;
    return {
      async load() {
        try {
          const response = await fetch(url, { cache: 'no-store' });
          const data = await response.json();
          return data && typeof data === 'object' ? data : emptyValue();
        } catch (error) {
          return emptyValue();
        }
      },
      save(data) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
            .catch(() => {});
        }, 300);
      },
      // sofort speichern (wenn direkt danach der Server die Daten braucht)
      saveNow(data) {
        clearTimeout(timer);
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .catch(() => {});
      }
    };
  }

  // ======================================================================
  // Ideen & Projekte (mit Ordnern)
  // ======================================================================
  // Daten: { folders: [{ id, name, parentId }], ideas: [{ id, folderId, title, note, status, created }] }

  const STATUS = [
    { id: 'idee', label: '💡 Idee', color: '#f5c542' },
    { id: 'arbeit', label: '🔧 In Arbeit', color: '#4f8ff7' },
    { id: 'fertig', label: '✅ Erledigt', color: '#43c96b' }
  ];
  const ideasStore = createStore('/api/ideen', () => ({ folders: [], ideas: [] }));
  let ideasData = { folders: [], ideas: [] };
  let selectedFolder = null;      // null = "Alle Ideen"
  let renamingFolder = null;
  const expandedFolders = new Set();
  let focusIdeaId = null;          // neue Idee: Titelfeld nach dem Zeichnen fokussieren

  function saveIdeas() {
    ideasStore.save(ideasData);
    renderIdeasMini();
  }

  function childFolders(parentId) {
    return ideasData.folders
      .filter(folder => (folder.parentId || null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  function folderPath(id) {
    const names = [];
    let folder = ideasData.folders.find(item => item.id === id);
    while (folder) {
      names.unshift(folder.name);
      folder = ideasData.folders.find(item => item.id === folder.parentId);
    }
    return names.join(' › ');
  }

  // Alle Ordner in Baum-Reihenfolge (für die Auswahlliste "Ordner" an jeder Idee)
  function flatFolders(parentId = null, depth = 0) {
    return childFolders(parentId).flatMap(folder => [{ folder, depth }, ...flatFolders(folder.id, depth + 1)]);
  }

  function statusOf(idea) {
    return STATUS.find(status => status.id === idea.status) || STATUS[0];
  }

  function renderFolderTree() {
    const tree = $('folder-tree');
    const rows = [folderRow(null, 0)];
    const addChildren = (parentId, depth) => {
      for (const folder of childFolders(parentId)) {
        rows.push(folderRow(folder, depth));
        if (expandedFolders.has(folder.id)) addChildren(folder.id, depth + 1);
      }
    };
    addChildren(null, 1);
    tree.replaceChildren(...rows);
    const renameInput = tree.querySelector('.tv-input');
    if (renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  }

  function folderRow(folder, depth) {
    const id = folder ? folder.id : null;
    const count = folder ? ideasData.ideas.filter(idea => idea.folderId === id).length : ideasData.ideas.length;
    const hasChildren = folder && childFolders(id).length > 0;
    const row = el('div', {
      class: `folder-row${selectedFolder === id ? ' selected' : ''}`,
      '--indent': `${6 + depth * 14}px`,
      onclick: () => {
        selectedFolder = id;
        renderIdeas();
      },
      // Ideen per Ziehen in einen Ordner verschieben
      ondragover: event => {
        event.preventDefault();
        row.classList.add('drop-target');
      },
      ondragleave: () => row.classList.remove('drop-target'),
      ondrop: event => {
        event.preventDefault();
        row.classList.remove('drop-target');
        const idea = ideasData.ideas.find(item => item.id === event.dataTransfer.getData('text/plain'));
        if (!idea) return;
        idea.folderId = id;
        saveIdeas();
        renderIdeas();
      }
    });

    const toggle = el('button', {
      type: 'button',
      class: 'folder-toggle',
      text: hasChildren ? (expandedFolders.has(id) ? '▾' : '▸') : '',
      'aria-label': 'Unterordner auf- oder zuklappen',
      onclick: event => {
        event.stopPropagation();
        if (!hasChildren) return;
        expandedFolders.has(id) ? expandedFolders.delete(id) : expandedFolders.add(id);
        renderFolderTree();
      }
    });

    if (folder && renamingFolder === id) {
      const finish = save => {
        if (renamingFolder !== id) return;
        renamingFolder = null;
        const name = input.value.trim();
        if (save && name) folder.name = name;
        saveIdeas();
        renderIdeas();
      };
      const input = el('input', {
        class: 'tv-input',
        value: folder.name,
        maxlength: 40,
        'aria-label': 'Ordnername',
        onclick: event => event.stopPropagation(),
        onkeydown: event => {
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') {
            event.stopPropagation();
            finish(false);
          }
        },
        onblur: () => finish(true)
      });
      row.append(toggle, el('span', { text: '📂' }), input);
      return row;
    }

    row.append(
      toggle,
      el('span', { text: folder ? (selectedFolder === id ? '📂' : '📁') : '🗂️' }),
      el('span', { class: 'folder-name', text: folder ? folder.name : 'Alle Ideen' }),
      el('span', { class: 'folder-count', text: String(count) })
    );
    if (folder) {
      row.append(
        el('button', {
          type: 'button', class: 'tv-icon-button', text: '✎', title: 'Umbenennen',
          onclick: event => {
            event.stopPropagation();
            renamingFolder = id;
            renderFolderTree();
          }
        }),
        el('button', {
          type: 'button', class: 'tv-icon-button', text: '×', title: 'Ordner löschen (Inhalt wandert eine Ebene nach oben)',
          onclick: event => {
            event.stopPropagation();
            deleteFolder(id);
          }
        })
      );
    }
    return row;
  }

  function addFolder() {
    const folder = { id: uid(), name: 'Neuer Ordner', parentId: selectedFolder };
    ideasData.folders.push(folder);
    if (selectedFolder) expandedFolders.add(selectedFolder);
    renamingFolder = folder.id;
    saveIdeas();
    renderIdeas();
  }

  // Ordner löschen: Ideen und Unterordner wandern in den übergeordneten Ordner – nichts geht verloren
  function deleteFolder(id) {
    const folder = ideasData.folders.find(item => item.id === id);
    if (!folder) return;
    const parent = folder.parentId || null;
    ideasData.ideas.forEach(idea => { if (idea.folderId === id) idea.folderId = parent; });
    ideasData.folders.forEach(item => { if (item.parentId === id) item.parentId = parent; });
    ideasData.folders = ideasData.folders.filter(item => item.id !== id);
    if (selectedFolder === id) selectedFolder = parent;
    saveIdeas();
    renderIdeas();
  }

  function addIdea() {
    const idea = { id: uid(), folderId: selectedFolder, title: '', note: '', status: 'idee', created: todayIso() };
    ideasData.ideas.unshift(idea);
    focusIdeaId = idea.id;
    saveIdeas();
    renderIdeas();
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 240)}px`;
  }

  function ideaCard(idea) {
    const status = statusOf(idea);
    const card = el('div', {
      class: `idea-card${idea.status === 'fertig' ? ' done' : ''}`,
      '--status-color': status.color,
      draggable: 'true',
      ondragstart: event => {
        event.dataTransfer.setData('text/plain', idea.id);
        card.classList.add('dragging');
      },
      ondragend: () => card.classList.remove('dragging')
    });

    const statusButton = el('button', {
      type: 'button', class: 'idea-status', text: status.label, title: 'Status wechseln',
      onclick: () => {
        const index = STATUS.findIndex(item => item.id === idea.status);
        idea.status = STATUS[(index + 1) % STATUS.length].id;
        saveIdeas();
        renderIdeaList();
      }
    });
    const title = el('input', {
      class: 'tv-input idea-title', value: idea.title, placeholder: 'Neue Idee …', maxlength: 120, 'aria-label': 'Titel der Idee',
      oninput: () => {
        idea.title = title.value;
        saveIdeas();
      }
    });
    const remove = el('button', {
      type: 'button', class: 'tv-icon-button', text: '×', title: 'Idee löschen',
      onclick: () => {
        ideasData.ideas = ideasData.ideas.filter(item => item.id !== idea.id);
        saveIdeas();
        renderIdeas();
      }
    });
    const note = el('textarea', {
      class: 'tv-textarea idea-note', rows: 2, placeholder: 'Notizen, nächste Schritte, Links …', 'aria-label': 'Notizen',
      oninput: () => {
        idea.note = note.value;
        autoGrow(note);
        saveIdeas();
      }
    });
    note.value = idea.note || '';

    const folderSelect = el('select', {
      class: 'tv-select', 'aria-label': 'Ordner',
      onchange: () => {
        idea.folderId = folderSelect.value || null;
        saveIdeas();
        renderIdeas();
      }
    }, el('option', { value: '', text: 'Ohne Ordner' }),
      ...flatFolders().map(({ folder, depth }) => el('option', { value: folder.id, text: `${'  '.repeat(depth)}📁 ${folder.name}` })));
    folderSelect.value = idea.folderId || '';

    card.append(
      el('div', { class: 'idea-row' }, statusButton, title, remove),
      note,
      el('div', { class: 'idea-meta' },
        folderSelect,
        el('span', { class: 'created', text: `angelegt ${dateLabel.format(dateFromIso(idea.created || todayIso()))}` }))
    );
    requestAnimationFrame(() => autoGrow(note));
    return card;
  }

  function renderIdeaList() {
    const list = $('idea-list');
    const ideas = ideasData.ideas
      .filter(idea => selectedFolder === null || idea.folderId === selectedFolder)
      .sort((a, b) => (a.status === 'fertig') - (b.status === 'fertig'));
    const heading = el('div', { class: 'idea-path', text: selectedFolder ? `📂 ${folderPath(selectedFolder)}` : '🗂️ Alle Ideen' });
    if (!ideas.length) {
      list.replaceChildren(heading, el('div', { class: 'tv-empty', text: 'Hier sind noch keine Ideen. Klick oben auf „+ Idee“ – oder lege mit „+ Ordner“ zuerst einen Ordner für dein Projekt an.' }));
      return;
    }
    list.replaceChildren(heading, ...ideas.map(ideaCard));
    if (focusIdeaId) {
      const index = ideas.findIndex(idea => idea.id === focusIdeaId);
      const input = list.querySelectorAll('.idea-title')[index];
      if (input) input.focus();
      focusIdeaId = null;
    }
  }

  function renderIdeas() {
    renderFolderTree();
    renderIdeaList();
    renderIdeasMini();
  }

  function renderIdeasMini() {
    const open = ideasData.ideas.filter(idea => idea.status !== 'fertig');
    $('ideas-count').textContent = String(ideasData.ideas.length);
    $('ideas-sub').textContent = `${open.length} offen · ${ideasData.folders.length} Ordner`;
    const latest = [...open].sort((a, b) => (b.created || '').localeCompare(a.created || '')).slice(0, 5);
    $('ideas-preview').replaceChildren(...(latest.length
      ? latest.map(idea => el('div', { class: 'preview-item' },
        el('span', { text: statusOf(idea).label.split(' ')[0] }),
        el('span', { text: idea.title || 'Ohne Titel' })))
      : [el('div', { class: 'preview-empty', text: 'Noch keine Ideen – klick hier, um die erste festzuhalten.' })]));
  }

  $('folder-add').addEventListener('click', addFolder);
  $('idea-add').addEventListener('click', addIdea);

  // ======================================================================
  // Gewohnheiten
  // ======================================================================
  // Daten: { habits: [{ id, name, color, created, done: ['YYYY-MM-DD', …] }] }

  const habitsStore = createStore('/api/gewohnheiten', () => ({ habits: [] }));
  let habitsData = { habits: [] };
  let viewMonthKey = null;       // angezeigter Monat 'YYYY-MM' (null = aktueller Monat)
  let scrollToToday = true;      // beim nächsten Zeichnen zum heutigen Tag scrollen
  let editingHabit = null;       // Gewohnheit, deren Bearbeiten-Box offen ist
  let confirmDeleteHabit = null;

  function saveHabits() {
    habitsStore.save(habitsData);
    renderHabitsMini();
  }

  function isDone(habit, date) {
    return (habit.done || []).includes(date);
  }

  let lastToggled = ''; // "habitId|Datum" – bekommt beim Abhaken eine kleine Animation

  function toggleHabit(habit, date) {
    habit.done = habit.done || [];
    habit.done = isDone(habit, date) ? habit.done.filter(item => item !== date) : [...habit.done, date].sort();
    lastToggled = `${habit.id}|${date}`;
    saveHabits();
    renderHabits();
    lastToggled = '';
  }

  // Serie: wie viele Tage am Stück erledigt (heute zählt mit, sonst ab gestern)
  function streak(habit) {
    let day = todayIso();
    if (!isDone(habit, day)) day = addDays(day, -1);
    let count = 0;
    while (isDone(habit, day)) {
      count++;
      day = addDays(day, -1);
    }
    return count;
  }

  function nextHabitColor() {
    const used = new Set(habitsData.habits.map(habit => habit.color));
    return (CATEGORY_COLORS.find(color => !used.has(color.value)) || CATEGORY_COLORS[habitsData.habits.length % CATEGORY_COLORS.length]).value;
  }

  // ---------- Kariertes Blatt: Tage des Monats als Zeilen, Gewohnheiten als Spalten ----------
  const monthTitle = new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', month: 'long', year: 'numeric' });

  function monthDays(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => isoDate(year, month, index + 1));
  }

  function shiftViewMonth(step) {
    const [year, month] = (viewMonthKey || todayIso().slice(0, 7)).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + step, 1));
    const key = date.toISOString().slice(0, 7);
    viewMonthKey = key === todayIso().slice(0, 7) ? null : key;
    scrollToToday = true;
    editingHabit = null;
    renderHabits();
  }

  // Kleine Box über dem Blatt: Name, Farbe, Winter Arc, Löschen
  function renderHabitEditor() {
    const box = $('habit-editor');
    const habit = habitsData.habits.find(item => item.id === editingHabit);
    if (!habit) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    box.hidden = false;
    const name = el('input', {
      class: 'tv-input', value: habit.name, maxlength: 60, 'aria-label': 'Name der Gewohnheit',
      onchange: () => {
        if (!name.value.trim()) return;
        habit.name = name.value.trim();
        saveHabits();
        renderHabits();
      },
      onkeydown: event => {
        if (event.key === 'Enter') name.blur();
        if (event.key === 'Escape') {
          event.stopPropagation();
          editingHabit = null;
          renderHabits();
        }
      }
    });
    const palette = el('div', { class: 'habit-palette' }, ...CATEGORY_COLORS.map(color => el('button', {
      type: 'button', class: color.value === habit.color ? 'selected' : null, '--c': color.value, title: color.name, 'aria-label': color.name,
      onclick: () => {
        habit.color = color.value;
        saveHabits();
        renderHabits();
      }
    })));
    const winter = winterEnabled() ? el('button', {
      type: 'button', class: `winter-toggle${habit.winterArc ? ' on' : ''}`,
      text: habit.winterArc ? `${arcIcon()} gehört zum ${arcName()}` : `${arcIcon()} zum ${arcName()} hinzufügen`,
      onclick: () => {
        habit.winterArc = !habit.winterArc;
        saveHabits();
        renderHabits();
      }
    }) : null;
    const remove = el('button', {
      type: 'button', class: 'tv-button', text: confirmDeleteHabit === habit.id ? 'Wirklich löschen? Nochmal klicken' : '🗑 Löschen',
      onclick: () => {
        if (confirmDeleteHabit !== habit.id) {
          confirmDeleteHabit = habit.id;
          renderHabitEditor();
          return;
        }
        confirmDeleteHabit = null;
        habitsData.habits = habitsData.habits.filter(item => item.id !== habit.id);
        editingHabit = null;
        saveHabits();
        renderHabits();
      }
    });
    box.replaceChildren(
      el('span', { class: 'habit-editor-dot', '--c': habit.color }),
      name, palette, winter, remove,
      el('button', { type: 'button', class: 'tv-icon-button', text: '×', title: 'Schließen', 'aria-label': 'Bearbeiten schließen', onclick: () => {
        editingHabit = null;
        confirmDeleteHabit = null;
        renderHabits();
      } }));
  }

  // Spaltenbreiten in px (müssen zu .col-day / .col-habit in tracker.css passen)
  const GRID_DAY_WIDTH = 80;
  const GRID_CELL_WIDTH = 46;
  const GRID_FILLER_MIN = 120;

  function renderHabitTable() {
    const table = $('habit-table');
    const headTable = $('habit-table-head');
    const today = todayIso();
    const yearMonth = viewMonthKey || today.slice(0, 7);
    const days = monthDays(yearMonth);
    const habits = habitsData.habits;
    $('habit-month').textContent = monthTitle.format(dateFromIso(days[0]));
    renderHabitEditor();

    if (!habits.length) {
      headTable.replaceChildren();
      table.style.minWidth = '';
      headTable.style.minWidth = '';
      table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'tv-empty', text: 'Noch keine Gewohnheiten. Füge unten deine erste hinzu – zum Beispiel „Sport“, „Lesen“ oder „💧 2 Liter Wasser“. Jede Gewohnheit wird eine Spalte, jeder Tag eine Zeile.' }))));
      return;
    }

    // Beide Tabellen (fester Kopf + scrollende Tage) bekommen dieselben Spaltenbreiten
    const columns = () => el('colgroup', {},
      el('col', { class: 'col-day' }),
      ...habits.map(() => el('col', { class: 'col-habit' })),
      el('col', { class: 'col-filler' }));
    const minWidth = `${GRID_DAY_WIDTH + habits.length * GRID_CELL_WIDTH + GRID_FILLER_MIN}px`;
    table.style.minWidth = minWidth;
    headTable.style.minWidth = minWidth;

    const pastDays = days.filter(day => day <= today);

    // Kopf: schräge Namen (Klick = bearbeiten), darunter Serie und Monats-Zähler
    const nameRow = el('tr', { class: 'grid-names' },
      el('th', { class: 'grid-corner', text: '' }),
      // linke Spalten liegen höher, damit ihr schräger Name über die rechte Nachbarspalte ragen darf
      ...habits.map((habit, index) => el('th', { class: `grid-head${editingHabit === habit.id ? ' editing' : ''}`, '--c': habit.color, style: { zIndex: String(5 + habits.length - index) } },
        el('button', {
          type: 'button', class: 'grid-head-button', title: `${habit.name} – klicken zum Bearbeiten`,
          onclick: () => {
            editingHabit = editingHabit === habit.id ? null : habit.id;
            confirmDeleteHabit = null;
            renderHabits();
          }
        }, el('span', { class: 'grid-head-label' },
          el('span', { class: 'grid-head-dot' }),
          `${habit.name}${habit.winterArc && winterEnabled() ? ` ${arcIcon()}` : ''}`)))),
      el('th', { class: 'grid-filler' }));
    const streakRow = el('tr', { class: 'grid-streak' },
      el('th', { class: 'grid-row-label', text: 'Serie' }),
      ...habits.map(habit => {
        const value = streak(habit);
        const heat = value >= 14 ? 'blazing' : value >= 7 ? 'hot' : value >= 3 ? 'warm' : value ? '' : 'none';
        return el('td', {}, el('span', { class: `streak-badge small ${heat}`, title: value ? `${value} Tage am Stück` : 'Noch keine Serie', text: value ? `🔥${value}` : '–' }));
      }),
      el('td', { class: 'grid-filler' }));
    const monthRow = el('tr', { class: 'grid-total' },
      el('th', { class: 'grid-row-label', text: 'Monat' }),
      ...habits.map(habit => el('td', { text: `${pastDays.filter(day => isDone(habit, day)).length}/${pastDays.length}` })),
      el('td', { class: 'grid-filler' }));

    // Ein Kästchen pro Tag und Gewohnheit: ✕ oder leer
    const rows = days.map(day => {
      const date = dateFromIso(day);
      const weekday = date.getUTCDay();
      const classes = [
        day === today ? 'today' : '',
        day > today ? 'future' : '',
        weekday === 0 || weekday === 6 ? 'weekend' : '',
        weekday === 0 ? 'week-end' : ''
      ].filter(Boolean).join(' ');
      return el('tr', { class: classes, 'data-date': day },
        el('th', { class: 'grid-day' },
          el('span', { class: 'grid-weekday', text: weekdayLabel.format(date).replace('.', '') }),
          el('span', { class: 'grid-date', text: `${Number(day.slice(8))}.` })),
        ...habits.map(habit => {
          const done = isDone(habit, day);
          return el('td', {}, el('button', {
            type: 'button',
            class: `grid-cell${done ? ' done' : ''}${done && lastToggled === `${habit.id}|${day}` ? ' just-done' : ''}`,
            '--c': habit.color,
            text: done ? '✕' : '',
            disabled: day > today,
            title: `${habit.name} – ${dateLabel.format(date)}`,
            'aria-label': `${habit.name} am ${dateLabel.format(date)}: ${done ? 'erledigt' : 'offen'}`,
            onclick: () => toggleHabit(habit, day)
          }));
        }),
        // Rest der Zeile: leeres Karopapier
        el('td', { class: 'grid-filler' }));
    });

    headTable.replaceChildren(columns(), el('thead', {}, nameRow, streakRow, monthRow));
    table.replaceChildren(columns(), el('tbody', {}, ...rows));

    // Beim Öffnen bzw. Monatswechsel zum heutigen Tag scrollen
    if (scrollToToday) {
      scrollToToday = false;
      const todayRow = table.querySelector('tr.today');
      const scroller = $('habit-grid-body');
      if (todayRow) {
        requestAnimationFrame(() => {
          // heutige Zeile in die Mitte des Tage-Bereichs
          scroller.scrollTop = Math.max(0, todayRow.offsetTop - scroller.clientHeight / 2 + todayRow.offsetHeight / 2);
        });
      } else {
        scroller.scrollTop = 0;
      }
    }
  }

  // Seitliches Scrollen der Tage nimmt den festen Kopf mit
  $('habit-grid-body').addEventListener('scroll', () => {
    const left = $('habit-grid-body').scrollLeft;
    $('habit-grid-head').scrollLeft = left;
    $('habit-table-wrap').classList.toggle('scrolled-x', left > 0);
  });

  function todayProgress() {
    const today = todayIso();
    const total = habitsData.habits.length;
    const done = habitsData.habits.filter(habit => isDone(habit, today)).length;
    return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
  }

  // Kennzahlen oben: Heute, stärkste Serie, Woche, Winter Arc
  function renderHabitStats() {
    const { done, total, percent } = todayProgress();
    const today = todayIso();
    const habits = habitsData.habits;

    let best = null;
    for (const habit of habits) {
      const value = streak(habit);
      if (!best || value > best.value) best = { habit, value };
    }

    // Diese Woche: erledigte Kästchen der letzten 7 Tage im Verhältnis zu allen möglichen
    const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
    const possible = habits.length * days.length;
    const doneCells = habits.reduce((sum, habit) => sum + days.filter(day => isDone(habit, day)).length, 0);
    const weekPercent = possible ? Math.round((doneCells / possible) * 100) : 0;

    const cards = [
      el('div', { class: 'stat-card' },
        el('div', { class: 'stat-ring', '--p': percent }),
        el('div', {}, el('div', { class: 'stat-value', text: `${done}/${total}` }), el('div', { class: 'stat-label', text: total && done === total ? 'Heute alles geschafft! 🎉' : 'heute erledigt' }))),
      el('div', { class: 'stat-card' },
        el('div', { class: 'stat-emoji', text: '🔥' }),
        el('div', {}, el('div', { class: 'stat-value', text: best && best.value ? `${best.value} ${best.value === 1 ? 'Tag' : 'Tage'}` : '–' }),
          el('div', { class: 'stat-label', text: best && best.value ? `stärkste Serie: ${best.habit.name}` : 'noch keine Serie' }))),
      el('div', { class: 'stat-card' },
        el('div', { class: 'stat-emoji', text: '📅' }),
        el('div', {}, el('div', { class: 'stat-value', text: `${weekPercent} %` }), el('div', { class: 'stat-label', text: 'der letzten 7 Tage geschafft' })))
    ];
    if (winterEnabled()) {
      const arc = winterStats();
      cards.push(el('button', { type: 'button', class: 'stat-card winter', onclick: () => openView('#winterarc') },
        el('div', { class: 'stat-emoji', text: arcIcon() }),
        el('div', {},
          el('div', { class: 'stat-value', text: arc.started ? `${arc.counter} ${arc.reset ? 'am Stück' : `/ ${arc.goal}`}` : 'Start' }),
          el('div', { class: 'stat-label', text: arc.started ? `${arcName()} · ${arc.completed} Tage abgehakt` : `${arcName()} starten` }))));
    }
    $('habit-stats').replaceChildren(...cards);
  }

  function renderHabits() {
    renderHabitTable();
    renderHabitStats();
    renderHabitsMini();
    renderWinter();
    if (!$('weight-panel').hidden) renderWeight();
  }

  // Mini-Kästchen: Fortschritt heute; beim Hovern die heutigen Gewohnheiten zum direkten Abhaken
  function renderHabitsMini() {
    const { done, total, percent } = todayProgress();
    $('habits-count').textContent = `${done}/${total}`;
    $('habits-bar').style.width = `${percent}%`;
    const today = todayIso();
    $('habits-preview').replaceChildren(...(habitsData.habits.length
      ? habitsData.habits.slice(0, 5).map(habit => el('div', { class: 'preview-item' },
        el('button', {
          type: 'button',
          class: `preview-check${isDone(habit, today) ? ' done' : ''}`,
          '--c': habit.color,
          text: isDone(habit, today) ? '✓' : '',
          'aria-label': `${habit.name} heute ${isDone(habit, today) ? 'erledigt' : 'abhaken'}`,
          onclick: event => {
            event.stopPropagation(); // nicht die große Ansicht öffnen
            toggleHabit(habit, today);
          }
        }),
        el('span', { text: habit.name })))
      : [el('div', { class: 'preview-empty', text: 'Noch keine Gewohnheiten – klick hier, um loszulegen.' })]));
  }

  $('habit-add-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('habit-add-input');
    const name = input.value.trim();
    if (!name) return;
    habitsData.habits.push({ id: uid(), name, color: nextHabitColor(), created: todayIso(), done: [] });
    input.value = '';
    saveHabits();
    renderHabits();
    input.focus();
  });
  // Monatsweise blättern (nicht über den aktuellen Monat hinaus)
  $('habit-prev').addEventListener('click', () => shiftViewMonth(-1));
  $('habit-next').addEventListener('click', () => {
    if (viewMonthKey) shiftViewMonth(1);
  });
  $('habit-today').addEventListener('click', () => {
    viewMonthKey = null;
    scrollToToday = true;
    renderHabits();
  });

  // ======================================================================
  // Winter Arc
  // ======================================================================
  // Einstellungen (einstellungen.json): winterArcEnabled, winterArcReset, winterArcGoal, winterArcStart
  // Ein Tag gilt als geschafft, wenn alle Winter-Arc-Gewohnheiten (❄) erledigt sind –
  // ist keine Gewohnheit mit ❄ markiert, zählen alle Gewohnheiten.

  const WINTER_QUOTES = [
    'Disziplin ist, wenn du es trotzdem machst.',
    'Jeder Tag zählt – gerade die kalten.',
    'Während andere Winterschlaf halten, wirst du stärker.',
    'Kein Tag null.',
    'Du baust gerade dein Frühlings-Ich.',
    'Kleine Schritte, jeden einzelnen Tag.',
    'Komfort ist der Feind des Fortschritts.',
    'Heute ist ein guter Tag, um durchzuziehen.',
    'Motivation kommt und geht – Gewohnheiten bleiben.',
    'Der Winter entscheidet, wie dein Sommer aussieht.'
  ];
  // Für einen eigenen Arc: dieselben Sprüche ohne Winter-Bezug
  const ARC_QUOTES = [
    'Disziplin ist, wenn du es trotzdem machst.',
    'Kein Tag null.',
    'Kleine Schritte, jeden einzelnen Tag.',
    'Komfort ist der Feind des Fortschritts.',
    'Heute ist ein guter Tag, um durchzuziehen.',
    'Motivation kommt und geht – Gewohnheiten bleiben.',
    'Du wirst jeden Tag ein bisschen besser.',
    'Dranbleiben schlägt Talent.',
    'Dein zukünftiges Ich wird dir danken.',
    'Nicht perfekt – aber jeden Tag.'
  ];
  let confirmRestart = false;

  const winterEnabled = () => typeof settings !== 'undefined' && settings.winterArcEnabled === true;

  // ---------- Aussehen: Winter Arc (blau, Schnee) oder eigener Arc (Name, Farbe, Emojis aus den Einstellungen) ----------
  const ARC_WINTER_COLOR = '#5aa8f0';
  const isWinterTheme = () => settings.arcTheme !== 'custom';
  const graphemes = new Intl.Segmenter('de', { granularity: 'grapheme' });

  function arcEmojis() {
    if (isWinterTheme()) return ['❄'];
    const list = [...graphemes.segment(settings.arcEmojis || '')].map(part => part.segment).filter(part => part.trim() && part !== ',');
    return list.length ? list.slice(0, 12) : ['🔥'];
  }
  const arcName = () => (isWinterTheme() ? 'Winter Arc' : String(settings.arcName || '').trim() || 'Arc');
  const arcIcon = () => arcEmojis()[0];
  const arcColor = () => (isWinterTheme() ? ARC_WINTER_COLOR : /^#[0-9a-f]{6}$/i.test(settings.arcColor || '') ? settings.arcColor : '#ff8a3d');

  // Ziel in Tagen: Vorgabe aus der Liste oder eigene Zahl ("Benutzerdefiniert")
  function arcGoal() {
    const value = Math.round(Number(settings.winterArcGoal === 'custom' ? settings.arcGoalCustom : settings.winterArcGoal));
    return value >= 1 && value <= 1000 ? value : 90;
  }

  // Farbe, Titel, Symbol und fallende Emojis an die Einstellungen anpassen
  function applyArcTheme() {
    document.documentElement.style.setProperty('--arc', arcColor());
    document.body.classList.toggle('arc-custom', !isWinterTheme());
    $('winter-title').textContent = `${arcIcon()} ${arcName()}`;
    $('winter-view').setAttribute('aria-label', arcName());
    document.querySelector('.winter-button-icon').textContent = arcIcon();
    buildSnow();
  }

  function winterHabits() {
    const marked = habitsData.habits.filter(habit => habit.winterArc);
    return marked.length ? marked : habitsData.habits;
  }

  // Ein Winter-Arc-Tag ist geschafft, wenn er mit "Tag abhaken" (Stimmung + kurzer Eintrag) abgehakt wurde
  function journalEntry(date) {
    return (habitsData.journal || {})[date] || null;
  }

  function winterDayDone(date) {
    return Boolean(journalEntry(date));
  }

  const MOODS = [
    { id: 'bad', emoji: '😞', label: 'schlecht' },
    { id: 'ok', emoji: '😐', label: 'mittel' },
    { id: 'good', emoji: '😊', label: 'gut' }
  ];
  const moodOf = id => MOODS.find(mood => mood.id === id) || MOODS[1];
  let journalOpen = null;        // { date, mode: 'edit' | 'view', mood, text }

  function winterStats() {
    const today = todayIso();
    const start = settings.winterArcStart;
    const goal = arcGoal();
    const reset = settings.winterArcReset === true;
    if (!start || start > today) return { started: false, goal, reset };

    const elapsed = daysBetween(start, today) + 1;
    let completed = 0;
    let best = 0;
    let run = 0;
    for (let day = start; day <= today; day = addDays(day, 1)) {
      if (winterDayDone(day)) {
        completed++;
        run++;
        best = Math.max(best, run);
      } else if (day !== today) {
        run = 0; // heute zählt erst, wenn der Tag vorbei ist
      }
    }
    // Aktuelle Serie: bis heute (wenn schon geschafft) bzw. bis gestern
    let current = 0;
    let day = winterDayDone(today) ? today : addDays(today, -1);
    while (day >= start && winterDayDone(day)) {
      current++;
      day = addDays(day, -1);
    }
    const counter = reset ? current : elapsed;
    return {
      started: true, start, goal, reset, elapsed, completed, current, best: Math.max(best, current), counter,
      end: addDays(start, goal - 1),
      progress: Math.min(1, counter / goal),
      finished: counter >= goal
    };
  }

  function winterButtonText(arc) {
    const name = arcName();
    if (!arc.started) return `${name} starten`;
    if (arc.finished) return `${name} geschafft! 🏆 ${arc.counter} Tage`;
    return arc.reset ? `${name} · 🔥 ${arc.counter} am Stück` : `${name} · Tag ${arc.counter}`;
  }

  // Button unter der Uhr + (falls offen) die große Ansicht aktualisieren
  function renderWinter() {
    const button = $('winter-button');
    button.hidden = !winterEnabled();
    applyArcTheme();
    if (winterEnabled()) $('winter-button-text').textContent = winterButtonText(winterStats());
    if (document.body.classList.contains('winter-open')) renderWinterView();
  }

  // Schneeflocken bzw. die eigenen Emojis erzeugen (neu nur, wenn sich die Auswahl ändert)
  function buildSnow() {
    const snow = $('winter-snow');
    const emojis = arcEmojis();
    const key = isWinterTheme() ? 'winter' : emojis.join('');
    if (snow.dataset.key === key) return;
    snow.dataset.key = key;
    snow.replaceChildren();
    const winter = isWinterTheme();
    for (let i = 0; i < (winter ? 36 : 26); i++) {
      snow.appendChild(el('span', {
        text: winter ? (i % 3 ? '❄' : '•') : emojis[i % emojis.length],
        style: {
          left: `${Math.random() * 100}%`,
          fontSize: `${winter ? 8 + Math.random() * 14 : 14 + Math.random() * 14}px`,
          animationDuration: `${9 + Math.random() * 12}s`,
          animationDelay: `${-Math.random() * 20}s`,
          opacity: String(0.35 + Math.random() * 0.5)
        },
        '--drift': `${-30 + Math.random() * 60}px`
      }));
    }
  }

  function winterRing(arc) {
    const radius = 90;
    const circumference = 2 * Math.PI * radius;
    const svg = `
      <svg viewBox="0 0 210 210" aria-hidden="true">
        <defs>
          <linearGradient id="winter-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style="stop-color: var(--arc-pale)"/>
            <stop offset="100%" style="stop-color: var(--arc)"/>
          </linearGradient>
        </defs>
        <circle class="track" cx="105" cy="105" r="${radius}"/>
        <circle class="progress" cx="105" cy="105" r="${radius}"
          stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${circumference.toFixed(1)}"/>
      </svg>`;
    const ring = el('div', { class: 'winter-ring', role: 'img', 'aria-label': `${arc.counter} von ${arc.goal} Tagen` });
    ring.innerHTML = svg;
    ring.append(el('div', { class: 'winter-ring-center' },
      el('div', { class: 'winter-day-label', text: arc.reset ? 'Tage am Stück' : 'Tag' }),
      el('div', { class: 'winter-day-number', text: String(arc.counter) }),
      el('div', { class: 'winter-day-goal', text: arc.finished ? 'Ziel erreicht! 🏆' : `von ${arc.goal} Tagen` })));
    // Fortschritt nach dem Einblenden animieren
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ring.querySelector('.progress').style.strokeDashoffset = (circumference * (1 - arc.progress)).toFixed(1);
    }));
    return ring;
  }

  function renderWinterView() {
    buildSnow();
    const today = todayIso();
    const quotes = isWinterTheme() ? WINTER_QUOTES : ARC_QUOTES;
    $('winter-quote').textContent = `„${quotes[daysBetween('2026-01-01', today) % quotes.length]}“`;
    const name = arcName();
    const icon = arcIcon();
    const body = $('winter-body');
    const footer = $('winter-footer');

    if (!winterEnabled()) {
      body.replaceChildren(el('div', { class: 'winter-empty' },
        el('div', { class: 'big', text: icon }),
        el('div', { text: `Der ${name} ist gerade ausgeschaltet.` }),
        el('button', { type: 'button', class: 'tv-button primary', text: 'In den Einstellungen aktivieren', onclick: () => openSettings() })));
      footer.replaceChildren();
      return;
    }

    const arc = winterStats();
    const counted = winterHabits().map(habit => habit.name);
    if (!arc.started) {
      body.replaceChildren(el('div', { class: 'winter-empty' },
        el('div', { class: 'big', text: icon }),
        el('strong', { text: `Bereit für deinen ${name}?` }),
        el('div', { text: `${arc.goal} ${arc.goal === 1 ? 'Tag' : 'Tage'} Disziplin. Jeden Abend hakst du deinen Tag ab – mit einer Stimmung und ein, zwei Sätzen Tagebuch. Jeder abgehakte Tag leuchtet auf.` }),
        el('div', { text: counted.length ? `Beim Abhaken siehst du als Erinnerung: ${counted.join(', ')} (auswählen mit ${icon} in den Gewohnheiten).` : 'Tipp: Lege Gewohnheiten an – beim Abhaken siehst du dann, was an dem Tag erledigt ist.' })));
      footer.replaceChildren(el('button', {
        type: 'button', class: 'winter-start', text: `${icon} ${name} starten`,
        onclick: () => {
          settings.winterArcStart = today;
          saveSettings();
          announceSettings();
        }
      }));
      return;
    }

    // Links: großer Zähler mit Fortschrittsring und Kennzahlen
    const hero = el('div', { class: 'winter-hero' },
      winterRing(arc),
      el('div', { class: 'winter-mini-stats' },
        el('div', { class: 'stat-card' }, el('div', {}, el('div', { class: 'stat-value', text: `${arc.completed}/${arc.elapsed}` }), el('div', { class: 'stat-label', text: 'Tage abgehakt' }))),
        el('div', { class: 'stat-card' }, el('div', {}, el('div', { class: 'stat-value', text: `🔥 ${arc.current}` }), el('div', { class: 'stat-label', text: 'aktuelle Serie' }))),
        el('div', { class: 'stat-card' }, el('div', {}, el('div', { class: 'stat-value', text: `⭐ ${arc.best}` }), el('div', { class: 'stat-label', text: 'beste Serie' }))),
        el('div', { class: 'stat-card' }, el('div', {}, el('div', { class: 'stat-value', text: dateLabel.format(dateFromIso(arc.end)).slice(0, 6) }), el('div', { class: 'stat-label', text: `Ziel (${arc.goal} Tage)` })))));

    // Rechts: jeder Tag des Winter Arc als Kästchen
    const lastDay = arc.end > today ? arc.end : today;
    const cells = [];
    let index = 1;
    for (let day = arc.start; day <= lastDay; day = addDays(day, 1), index++) {
      const entry = journalEntry(day);
      const dayNumber = index;
      let state = 'future';
      if (day <= today) state = entry ? 'done' : day === today ? '' : 'missed';
      const cell = el('button', {
        type: 'button',
        class: `winter-cell ${state}${day === today ? ' today' : ''}${entry ? ' journaled' : ''}`,
        text: entry ? moodOf(entry.mood).emoji : String(index),
        disabled: day > today,
        'aria-label': `Tag ${index}, ${dateLabel.format(dateFromIso(day))}: ${entry ? `abgehakt, Stimmung ${moodOf(entry.mood).label}` : day > today ? 'kommt noch' : 'nicht abgehakt'}`,
        // Hover: kleine Tagebuch-Vorschau; Klick: Eintrag öffnen (oder nachtragen)
        onmouseenter: () => showJournalPeek(cell, day, dayNumber),
        onmouseleave: hideJournalPeek,
        onfocus: () => showJournalPeek(cell, day, dayNumber),
        onblur: hideJournalPeek,
        onclick: () => openJournal(day, entry ? 'view' : 'edit')
      });
      cells.push(cell);
    }
    const days = el('div', { class: 'winter-days' },
      el('h3', { text: 'Deine Tage · Tagebuch' }),
      el('div', { class: 'winter-legend' },
        el('span', { '--c': 'var(--arc-light)', text: 'abgehakt (😞 😐 😊)' }),
        el('span', { '--c': 'rgba(255,90,90,0.5)', text: 'nicht abgehakt' }),
        el('span', { '--c': 'rgba(255,255,255,0.15)', text: 'kommt noch' })),
      el('div', { class: 'winter-grid' }, ...cells),
      el('div', { class: 'stat-label', text: 'Fahr mit der Maus über einen Tag für die Vorschau, klick drauf für den ganzen Eintrag.' }),
      el('div', { class: 'journal-peek', id: 'journal-peek', hidden: true }));
    body.replaceChildren(hero, days);
    if (journalOpen) body.appendChild(renderJournalDialog());

    const todayEntry = journalEntry(today);
    footer.replaceChildren(
      todayEntry
        ? el('button', { type: 'button', class: 'tv-button', text: `${moodOf(todayEntry.mood).emoji} Heute abgehakt – Eintrag ansehen`, onclick: () => openJournal(today, 'view') })
        : el('button', { type: 'button', class: 'winter-start small', text: '✓ Tag abhaken', onclick: () => openJournal(today, 'edit') }),
      el('button', { type: 'button', class: 'tv-button', text: '✓ Gewohnheiten', onclick: () => openView('#gewohnheiten') }),
      el('button', {
        type: 'button', class: 'tv-button', text: confirmRestart ? 'Wirklich neu starten? Nochmal klicken' : '↺ Neu starten',
        onclick: () => {
          if (!confirmRestart) {
            confirmRestart = true;
            renderWinterView();
            setTimeout(() => {
              confirmRestart = false;
              if (document.body.classList.contains('winter-open')) renderWinterView();
            }, 4000);
            return;
          }
          confirmRestart = false;
          settings.winterArcStart = todayIso();
          saveSettings();
          announceSettings();
        }
      }));
  }

  // ---------- Tagebuch: "Tag abhaken" ----------
  function winterDayIndex(date) {
    return settings.winterArcStart ? daysBetween(settings.winterArcStart, date) + 1 : null;
  }

  function journalDayTitle(date) {
    const index = winterDayIndex(date);
    return `${index ? `Tag ${index} · ` : ''}${new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromIso(date))}`;
  }

  function showJournalPeek(cell, date, dayNumber) {
    const peek = $('journal-peek');
    if (!peek) return;
    const entry = journalEntry(date);
    const today = todayIso();
    peek.replaceChildren(
      el('strong', { text: `Tag ${dayNumber} · ${dateLabel.format(dateFromIso(date))}` }),
      entry
        ? el('div', { class: 'peek-text' }, el('span', { class: 'peek-mood', text: moodOf(entry.mood).emoji }), entry.text)
        : el('div', { class: 'peek-text muted', text: date > today ? 'Kommt noch.' : date === today ? 'Heute noch nicht abgehakt – klick zum Abhaken.' : 'Nicht abgehakt – klick zum Nachtragen.' }));
    const box = cell.closest('.winter-days');
    const boxRect = box.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    peek.hidden = false;
    const left = Math.min(Math.max(8, cellRect.left - boxRect.left + cellRect.width / 2 - peek.offsetWidth / 2), boxRect.width - peek.offsetWidth - 8);
    peek.style.left = `${left}px`;
    peek.style.top = `${cellRect.bottom - boxRect.top + box.scrollTop + 6}px`;
  }

  function hideJournalPeek() {
    const peek = $('journal-peek');
    if (peek) peek.hidden = true;
  }

  function openJournal(date, mode) {
    if (date > todayIso()) return;
    const entry = journalEntry(date);
    journalOpen = { date, mode: entry ? mode : 'edit', mood: entry ? entry.mood : null, text: entry ? entry.text : '' };
    refreshJournal();
  }

  function closeJournal() {
    journalOpen = null;
    refreshJournal();
  }

  // Nur den Dialog austauschen, damit Ring und Kästchen nicht neu animieren
  function refreshJournal() {
    hideJournalPeek();
    const body = $('winter-body');
    const old = body.querySelector('.journal-dialog');
    if (old) old.remove();
    if (!journalOpen) return;
    body.appendChild(renderJournalDialog());
    const focusTarget = body.querySelector('.journal-dialog textarea') || body.querySelector('.journal-dialog .primary');
    if (focusTarget) focusTarget.focus();
  }

  function renderJournalDialog() {
    const { date, mode } = journalOpen;
    const entry = journalEntry(date);
    const dialog = el('div', { class: 'journal-dialog', role: 'dialog', 'aria-label': 'Tagebuch-Eintrag' });
    const card = el('div', { class: 'journal-card' });
    dialog.appendChild(card);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) closeJournal();
    });

    if (mode === 'view' && entry) {
      card.append(
        el('div', { class: 'journal-title', text: journalDayTitle(date) }),
        el('div', { class: 'journal-big-mood', text: moodOf(entry.mood).emoji, title: `Stimmung: ${moodOf(entry.mood).label}` }),
        el('p', { class: 'journal-text', text: entry.text }),
        el('div', { class: 'stat-label', text: `abgehakt am ${dateLabel.format(dateFromIso(entry.at || date))}` }),
        el('div', { class: 'journal-actions' },
          el('button', { type: 'button', class: 'tv-button', text: '✎ Bearbeiten', onclick: () => {
            journalOpen = { date, mode: 'edit', mood: entry.mood, text: entry.text };
            refreshJournal();
          } }),
          el('button', { type: 'button', class: 'tv-button', text: '↺ Abhaken zurücknehmen', onclick: () => {
            delete habitsData.journal[date];
            saveHabits();
            journalOpen = null;
            renderHabits();
          } }),
          el('button', { type: 'button', class: 'tv-button primary', text: 'Schließen', onclick: closeJournal })));
      return dialog;
    }

    // Bearbeiten / neu: Stimmung wählen + ein, zwei Sätze → erst dann "Tag abhaken"
    const habits = winterHabits();
    const doneHabits = habits.filter(habit => isDone(habit, date));
    const submit = el('button', { type: 'button', class: 'winter-start small', text: '✓ Tag abhaken' });
    const hint = el('div', { class: 'journal-hint' });
    const updateSubmit = () => {
      const ready = Boolean(journalOpen.mood) && journalOpen.text.trim().length >= 3;
      submit.disabled = !ready;
      hint.textContent = ready ? '' : !journalOpen.mood ? 'Wähle zuerst, wie dein Tag war.' : 'Schreib noch kurz ein, zwei Sätze zu deinem Tag.';
    };
    const moods = el('div', { class: 'journal-moods' }, ...MOODS.map(mood => el('button', {
      type: 'button',
      class: `journal-mood${journalOpen.mood === mood.id ? ' selected' : ''}`,
      'aria-pressed': String(journalOpen.mood === mood.id),
      title: mood.label,
      onclick: event => {
        journalOpen.mood = mood.id;
        moods.querySelectorAll('.journal-mood').forEach(button => {
          button.classList.toggle('selected', button === event.currentTarget);
          button.setAttribute('aria-pressed', String(button === event.currentTarget));
        });
        updateSubmit();
      }
    }, el('span', { class: 'emoji', text: mood.emoji }), el('span', { text: mood.label }))));
    const textarea = el('textarea', {
      class: 'tv-textarea', rows: 3, maxlength: 400, placeholder: 'Ein, zwei Sätze: Was lief gut? Was war schwer? Was nimmst du mit?', 'aria-label': 'Tagebuch-Eintrag',
      oninput: () => {
        journalOpen.text = textarea.value;
        updateSubmit();
      }
    });
    textarea.value = journalOpen.text;
    submit.addEventListener('click', () => {
      if (submit.disabled) return;
      habitsData.journal = habitsData.journal || {};
      habitsData.journal[date] = { mood: journalOpen.mood, text: journalOpen.text.trim(), at: todayIso() };
      saveHabits();
      journalOpen = { date, mode: 'view' };
      renderHabits(); // Zähler, Button unter der Uhr, Ansicht
    });

    card.append(
      el('div', { class: 'journal-title', text: journalDayTitle(date) }),
      el('div', { class: 'journal-question', text: 'Wie war dein Tag?' }),
      moods,
      textarea,
      habits.length
        ? el('div', { class: 'stat-label', text: `${habits === habitsData.habits ? 'Gewohnheiten' : `${arcIcon()}-Gewohnheiten`} an diesem Tag: ${doneHabits.length}/${habits.length} erledigt${doneHabits.length < habits.length ? ` – offen: ${habits.filter(habit => !isDone(habit, date)).map(habit => habit.name).join(', ')}` : ' 💪'}` })
        : null,
      hint,
      el('div', { class: 'journal-actions' },
        el('button', { type: 'button', class: 'tv-button', text: 'Abbrechen', onclick: () => (entry ? openJournal(date, 'view') : closeJournal()) }),
        submit));
    updateSubmit();
    return dialog;
  }

  // Escape schließt zuerst den Tagebuch-Eintrag
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && journalOpen && document.body.classList.contains('winter-open')) {
      event.stopImmediatePropagation();
      closeJournal();
    }
  }, true);

  $('winter-button').addEventListener('click', () => openView('#winterarc'));
  $('winter-settings').addEventListener('click', () => openSettings());

  // ======================================================================
  // Gewicht: Einträge + Liniendiagramm
  // ======================================================================
  // Daten (gewohnheiten.json): weights: [{ id, date: 'YYYY-MM-DD', kg }] – ein Eintrag pro Tag

  const kgFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const shortDate = iso => `${iso.slice(8)}.${iso.slice(5, 7)}.`;

  function weights() {
    return [...(habitsData.weights || [])].sort((a, b) => a.date.localeCompare(b.date));
  }

  function openWeight() {
    $('weight-panel').hidden = false;
    $('weight-date').value = todayIso();
    $('weight-date').max = todayIso();
    renderWeight();
    $('weight-kg').focus();
  }

  function closeWeight() {
    $('weight-panel').hidden = true;
  }

  function renderWeight() {
    const list = weights();
    const latest = list[list.length - 1];
    const first = list[0];
    const values = list.map(entry => entry.kg);
    const change = latest && first ? latest.kg - first.kg : 0;
    const card = (emoji, value, label) => el('div', { class: 'stat-card' },
      el('div', { class: 'stat-emoji', text: emoji }),
      el('div', {}, el('div', { class: 'stat-value', text: value }), el('div', { class: 'stat-label', text: label })));
    $('weight-stats').replaceChildren(
      card('⚖️', latest ? `${kgFormat.format(latest.kg)} kg` : '–', latest ? `aktuell (${shortDate(latest.date)})` : 'noch kein Eintrag'),
      card(change < 0 ? '📉' : '📈', list.length > 1 ? `${change > 0 ? '+' : change < 0 ? '−' : '±'}${kgFormat.format(Math.abs(change))} kg` : '–', list.length > 1 ? `seit ${shortDate(first.date)}` : 'Veränderung'),
      card('⬇️', values.length ? `${kgFormat.format(Math.min(...values))} kg` : '–', 'niedrigster Wert'),
      card('⬆️', values.length ? `${kgFormat.format(Math.max(...values))} kg` : '–', 'höchster Wert'));

    // Tabelle der Einträge (neueste oben) – zugleich die Tabellen-Ansicht zum Diagramm
    const rows = [...list].reverse().map((entry, index, reversed) => {
      const previous = reversed[index + 1];
      const delta = previous ? entry.kg - previous.kg : null;
      return el('tr', {},
        el('td', { text: dateLabel.format(dateFromIso(entry.date)) }),
        el('td', { class: 'kg' }, `${kgFormat.format(entry.kg)} kg `,
          delta === null ? null : el('span', { class: 'delta', text: `(${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${kgFormat.format(Math.abs(delta))})` })),
        el('td', {}, el('button', {
          type: 'button', class: 'tv-icon-button', text: '×', title: 'Eintrag löschen',
          onclick: () => {
            habitsData.weights = (habitsData.weights || []).filter(item => item.id !== entry.id);
            saveHabits();
            renderWeight();
          }
        })));
    });
    $('weight-list').replaceChildren(list.length
      ? el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Datum' }), el('th', { text: 'Gewicht' }), el('th', {}))), el('tbody', {}, ...rows))
      : el('div', { class: 'tv-empty', text: 'Noch keine Einträge. Trag oben dein Gewicht ein – so oft du willst.' }));

    drawWeightChart(list);
  }

  // Schöne Achsen-Schritte (0,5 / 1 / 2 / 5 / 10 kg)
  function niceStep(range) {
    const raw = range / 4;
    return [0.5, 1, 2, 5, 10, 20].find(step => step >= raw) || 50;
  }

  function drawWeightChart(list) {
    const box = $('weight-chart');
    const width = Math.max(260, box.clientWidth - 20);
    const height = Math.max(180, box.clientHeight - 20);
    if (!list.length) {
      box.replaceChildren(el('div', { class: 'tv-empty', text: 'Hier erscheint dein Gewichtsverlauf als Liniendiagramm, sobald du etwas eingetragen hast.' }));
      return;
    }
    const margin = { top: 16, right: 18, bottom: 30, left: 48 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;

    const times = list.map(entry => dateFromIso(entry.date).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const values = list.map(entry => entry.kg);
    const step = niceStep(Math.max(1, Math.max(...values) - Math.min(...values)));
    const minY = Math.floor((Math.min(...values) - step / 2) / step) * step;
    const maxY = Math.ceil((Math.max(...values) + step / 2) / step) * step;

    const x = time => margin.left + (maxT === minT ? plotW / 2 : ((time - minT) / (maxT - minT)) * plotW);
    const y = value => margin.top + (1 - (value - minY) / (maxY - minY)) * plotH;
    const points = list.map((entry, index) => ({ entry, px: x(times[index]), py: y(entry.kg) }));

    const parts = [];
    parts.push(`<defs><linearGradient id="weight-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8fd3ff" stop-opacity="0.35"/><stop offset="100%" stop-color="#8fd3ff" stop-opacity="0"/></linearGradient></defs>`);
    // Waagerechte Hilfslinien mit kg-Werten
    for (let value = minY; value <= maxY + 0.001; value += step) {
      const py = y(value).toFixed(1);
      parts.push(`<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${py}" y2="${py}"/>`);
      parts.push(`<text class="axis-label" x="${margin.left - 8}" y="${py}" text-anchor="end" dominant-baseline="middle">${kgFormat.format(value)}</text>`);
    }
    // Datums-Beschriftung: höchstens 6, gleichmäßig verteilt
    const labelCount = Math.min(6, points.length);
    const shown = new Set(Array.from({ length: labelCount }, (_, i) => Math.round(labelCount === 1 ? 0 : (i * (points.length - 1)) / (labelCount - 1))));
    for (const index of shown) {
      const point = points[index];
      parts.push(`<text class="axis-label" x="${point.px.toFixed(1)}" y="${height - 8}" text-anchor="middle">${shortDate(point.entry.date)}</text>`);
    }
    if (points.length > 1) {
      const line = points.map((point, i) => `${i ? 'L' : 'M'}${point.px.toFixed(1)},${point.py.toFixed(1)}`).join(' ');
      const baseY = (margin.top + plotH).toFixed(1);
      parts.push(`<path class="area" d="${line} L${points[points.length - 1].px.toFixed(1)},${baseY} L${points[0].px.toFixed(1)},${baseY} Z"/>`);
      parts.push(`<path class="line" d="${line}"/>`);
    }
    parts.push(`<line class="crosshair" x1="0" x2="0" y1="${margin.top}" y2="${margin.top + plotH}" visibility="hidden"/>`);
    for (const point of points) {
      parts.push(`<circle class="point" cx="${point.px.toFixed(1)}" cy="${point.py.toFixed(1)}" r="4"/>`);
    }
    parts.push(`<rect class="hit" x="${margin.left - 10}" y="0" width="${plotW + 20}" height="${height}" fill="transparent"/>`);

    box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gewichtsverlauf: ${points.length} Einträge von ${shortDate(list[0].date)} bis ${shortDate(list[list.length - 1].date)}">${parts.join('')}</svg>`;
    const tooltip = el('div', { class: 'weight-tooltip', hidden: true });
    box.appendChild(tooltip);

    // Hover: Fadenkreuz + Tooltip am nächsten Eintrag
    const svg = box.querySelector('svg');
    const crosshair = svg.querySelector('.crosshair');
    const circles = [...svg.querySelectorAll('.point')];
    const hit = svg.querySelector('.hit');
    hit.addEventListener('mousemove', event => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((event.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      points.forEach((point, index) => {
        if (Math.abs(point.px - mouseX) < Math.abs(points[nearest].px - mouseX)) nearest = index;
      });
      const point = points[nearest];
      crosshair.setAttribute('x1', point.px);
      crosshair.setAttribute('x2', point.px);
      crosshair.setAttribute('visibility', 'visible');
      circles.forEach((circle, index) => circle.classList.toggle('active', index === nearest));
      const previous = points[nearest - 1];
      const delta = previous ? point.entry.kg - previous.entry.kg : null;
      tooltip.replaceChildren(
        el('strong', { text: `${kgFormat.format(point.entry.kg)} kg` }),
        el('div', { text: dateLabel.format(dateFromIso(point.entry.date)) }),
        delta === null ? null : el('div', { text: `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${kgFormat.format(Math.abs(delta))} kg zum Eintrag davor` }));
      tooltip.style.left = `${10 + (point.px / width) * rect.width}px`;
      tooltip.style.top = `${10 + (point.py / height) * rect.height}px`;
      tooltip.hidden = false;
    });
    hit.addEventListener('mouseleave', () => {
      crosshair.setAttribute('visibility', 'hidden');
      circles.forEach(circle => circle.classList.remove('active'));
      tooltip.hidden = true;
    });
  }

  $('weight-open').addEventListener('click', openWeight);
  $('weight-back').addEventListener('click', closeWeight);
  $('weight-form').addEventListener('submit', event => {
    event.preventDefault();
    const kg = parseFloat(String($('weight-kg').value).replace(',', '.'));
    const date = $('weight-date').value || todayIso();
    if (!Number.isFinite(kg) || kg < 20 || kg > 400 || date > todayIso()) return;
    habitsData.weights = (habitsData.weights || []).filter(entry => entry.date !== date); // ein Eintrag pro Tag
    habitsData.weights.push({ id: uid(), date, kg: Math.round(kg * 10) / 10 });
    saveHabits();
    $('weight-kg').value = '';
    renderWeight();
  });
  window.addEventListener('resize', () => {
    if (!$('weight-panel').hidden) drawWeightChart(weights());
  });

  // ======================================================================
  // Mini-Kästchen öffnen die große Ansicht; neu zeichnen beim Öffnen und um Mitternacht
  // ======================================================================

  for (const [id, hash] of [['ideas-mini', '#ideen'], ['habits-mini', '#gewohnheiten']]) {
    const mini = $(id);
    mini.addEventListener('click', () => openView(hash));
    mini.addEventListener('keydown', event => {
      if (event.target !== mini) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openView(hash);
      }
    });
  }

  document.addEventListener('view-changed', event => {
    if (event.detail.view === 'ideas') renderIdeas();
    if (event.detail.view === 'habits') {
      viewMonthKey = null;
      scrollToToday = true;
      editingHabit = null;
      renderHabits();
    } else {
      closeWeight();
    }
    journalOpen = null;
    if (event.detail.view === 'winter') renderWinterView();
    if (event.detail.view !== 'ideas') renamingFolder = null;
  });
  // Winter Arc ein/aus, Ziel, Start … → Button, Ansicht und Gewohnheiten neu zeichnen
  document.addEventListener('settings-changed', () => {
    // Motivations-Kachel lässt sich in den Einstellungen ganz ausblenden
    $('motivation-tile').hidden = settings.motivationEnabled === false;
    renderHabits();
  });

  let lastDay = todayIso();
  setInterval(() => {
    if (todayIso() !== lastDay) {
      lastDay = todayIso();
      renderHabits();
    }
  }, 60000);

  (async () => {
    ideasData = await ideasStore.load();
    ideasData.folders = Array.isArray(ideasData.folders) ? ideasData.folders : [];
    ideasData.ideas = Array.isArray(ideasData.ideas) ? ideasData.ideas : [];
    habitsData = await habitsStore.load();
    habitsData.habits = Array.isArray(habitsData.habits) ? habitsData.habits : [];
    habitsData.weights = Array.isArray(habitsData.weights) ? habitsData.weights : [];
    habitsData.journal = habitsData.journal && typeof habitsData.journal === 'object' ? habitsData.journal : {};
    renderIdeas();
    renderHabits();
  })();

  // ======================================================================
  // Motivation: Kachel "Ich brauche Motivation" → Instagram-Video im Overlay
  // ======================================================================
  // Zwei Wege (Einstellung "Videos live von Instagram-Accounts holen" = settings.motivationLive):
  //  - Standard (aus): fest gespeicherte Instagram-Links, zufällig ausgewählt
  //  - Live (an):      der Server holt bei jedem Klick ein Video von ausgewählten Accounts
  //                    (Business Discovery der Instagram-API); das Video wird nicht gespeichert
  // Daten: { videos: [{ id, kind, code, url, added }], lastShown, accounts: [{ id, username }], filter }

  const motivationStore = createStore('/api/motivation', () => ({ videos: [], accounts: [], filter: true }));
  let motivationData = { videos: [], accounts: [], filter: true };
  let currentVideo = null;       // nur solange das Overlay offen ist
  let lastPermalink = '';        // Live-Modus: damit "Anderes Video" nicht dasselbe zeigt
  let requestNumber = 0;

  const liveMode = () => typeof settings !== 'undefined' && settings.motivationLive === true;

  // "https://www.instagram.com/reel/ABC123/?igsh=…" → { kind: 'reel', code: 'ABC123' }
  function parseInstagramLink(text) {
    const match = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,})/i.exec(String(text || ''));
    if (!match) return null;
    return { kind: match[1].toLowerCase() === 'p' ? 'p' : 'reel', code: match[2] };
  }

  // "@name", "name" oder "https://www.instagram.com/name/" → "name"
  function parseAccount(text) {
    const value = String(text || '').trim();
    const fromLink = /instagram\.com\/([A-Za-z0-9_.]{1,30})\/?(?:[?#].*)?$/i.exec(value);
    const name = (fromLink ? fromLink[1] : value.replace(/^@/, '')).toLowerCase();
    return /^[a-z0-9_.]{1,30}$/.test(name) && !['reel', 'reels', 'p', 'tv', 'explore', 'stories'].includes(name) ? name : null;
  }

  // Ein Link von Instagram, TikTok oder YouTube (Shorts) → { platform, kind, code }
  // TikTok-Kurzlinks (vm.tiktok.com/…) enthalten keine Video-Nummer → { platform: 'tiktok', shortUrl }
  function parseVideoLink(text) {
    const value = String(text || '').trim();
    const instagram = parseInstagramLink(value);
    if (instagram) return { platform: 'instagram', ...instagram };

    const tiktok = /tiktok\.com\/(?:@[^/?#]+\/video|embed(?:\/v2)?|player\/v1|v)\/(\d{8,25})/i.exec(value);
    if (tiktok) return { platform: 'tiktok', kind: 'video', code: tiktok[1] };
    const tiktokShort = /^https?:\/\/(?:(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]+|(?:www\.)?tiktok\.com\/t\/[A-Za-z0-9]+)\/?/i.exec(value);
    if (tiktokShort) return { platform: 'tiktok', shortUrl: tiktokShort[0] };

    const youtube = /(?:youtube\.com\/(?:shorts\/|watch\?(?:.*&)?v=|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i.exec(value);
    if (youtube) return { platform: 'youtube', kind: /shorts\//i.test(value) ? 'short' : 'video', code: youtube[1] };
    return null;
  }

  const platformOf = video => video.platform || 'instagram'; // ältere Einträge: Instagram
  const PLATFORM_NAMES = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };

  function videoUrl(video) {
    if (platformOf(video) === 'tiktok') return `https://www.tiktok.com/@/video/${video.code}`;
    if (platformOf(video) === 'youtube') return `https://www.youtube.com/shorts/${video.code}`;
    return `https://www.instagram.com/${video.kind}/${video.code}/`;
  }

  // Offizielle Einbett-Player der Plattformen
  function embedUrl(video) {
    if (platformOf(video) === 'tiktok') {
      return `https://www.tiktok.com/player/v1/${video.code}?autoplay=1&loop=1&rel=0&music_info=1&description=1`;
    }
    if (platformOf(video) === 'youtube') {
      return `https://www.youtube-nocookie.com/embed/${video.code}?autoplay=1&loop=1&playlist=${video.code}&playsinline=1&rel=0&modestbranding=1`;
    }
    return `https://www.instagram.com/${video.kind}/${video.code}/embed/`;
  }

  function videoLabel(video) {
    if (platformOf(video) === 'tiktok') return `🎵 TikTok ${video.code}`;
    if (platformOf(video) === 'youtube') return `▶️ YouTube-Short ${video.code}`;
    return `📷 Instagram-${video.kind === 'p' ? 'Beitrag' : 'Reel'} ${video.code}`;
  }

  function setMotivationStatus(text, warn = false) {
    const status = $('mo-status');
    status.textContent = text;
    status.classList.toggle('warn', warn);
  }

  // Sofort speichern: im Live-Modus liest der Server die Accounts direkt aus der Datei
  function saveMotivation() {
    return motivationStore.saveNow(motivationData);
  }

  // Verwaltungsbereich passend zum Modus: Video-Links oder Accounts
  function renderMotivationManage() {
    const live = liveMode();
    $('mo-links-section').hidden = live;
    $('mo-accounts-section').hidden = !live;
    $('mo-summary').textContent = live
      ? `Accounts verwalten (${motivationData.accounts.length})`
      : `Videos verwalten (${motivationData.videos.length})`;

    $('mo-video-list').replaceChildren(...motivationData.videos.map(video => el('li', {},
      el('a', { href: video.url || videoUrl(video), target: '_blank', rel: 'noopener', text: videoLabel(video) }),
      el('button', {
        type: 'button', class: 'tv-icon-button', text: '×', title: 'Aus der Liste entfernen',
        onclick: () => {
          motivationData.videos = motivationData.videos.filter(item => item.id !== video.id);
          saveMotivation();
          renderMotivationManage();
          if (currentVideo && currentVideo.id === video.id) showNextVideo();
        }
      }))));

    $('mo-filter').checked = motivationData.filter !== false;
    $('mo-list').replaceChildren(...motivationData.accounts.map(account => el('li', {},
      el('a', { href: `https://www.instagram.com/${account.username}/`, target: '_blank', rel: 'noopener', text: `@${account.username}` }),
      el('button', {
        type: 'button', class: 'tv-icon-button', text: '×', title: 'Account entfernen',
        onclick: () => {
          motivationData.accounts = motivationData.accounts.filter(item => item.id !== account.id);
          saveMotivation();
          renderMotivationManage();
        }
      }))));
  }

  function showMessage(title, text, { openManage = false } = {}) {
    $('mo-stage').replaceChildren(el('div', { class: 'mo-empty' }, el('strong', { text: title }), text));
    $('mo-source').textContent = '';
    $('mo-open').hidden = true;
    if (openManage) $('mo-manage').open = true;
  }

  function embed(video, source) {
    const platform = PLATFORM_NAMES[platformOf(video)];
    $('mo-stage').replaceChildren(el('iframe', {
      src: embedUrl(video),
      title: `Motivationsvideo von ${platform}`,
      allow: 'autoplay; encrypted-media; clipboard-write; picture-in-picture; fullscreen; web-share',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin'
    }));
    $('mo-open').href = video.url || videoUrl(video);
    $('mo-open').textContent = `In ${platform} öffnen`;
    $('mo-open').hidden = false;
    if (source) {
      $('mo-source').replaceChildren(...source);
    } else {
      $('mo-source').textContent = '';
    }
  }

  // ---------- Standard: gespeicherte Links ----------
  function pickSavedVideo() {
    const videos = motivationData.videos;
    if (!videos.length) return null;
    const lastId = currentVideo ? currentVideo.id : motivationData.lastShown;
    const pool = videos.length > 1 ? videos.filter(video => video.id !== lastId) : videos;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function showSavedVideo() {
    const video = pickSavedVideo();
    currentVideo = video;
    $('mo-next').disabled = motivationData.videos.length < 2;
    if (!video) {
      showMessage('Noch keine Motivationsvideos gespeichert',
        'Tippe in Instagram, TikTok oder YouTube bei einem Video auf „Teilen“ → „Link kopieren“ und füge ihn unten ein. Danach zeigt dir dieser Knopf jedes Mal zufällig eines deiner Videos.',
        { openManage: true });
      return;
    }
    embed(video);
    motivationData.lastShown = video.id;
    motivationStore.save(motivationData);
  }

  // TikTok-Kurzlink über den Server auflösen (der Browser darf der Weiterleitung nicht selbst folgen)
  async function resolveShortLink(url) {
    try {
      const response = await fetch(`/api/resolve-link?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
      const data = await response.json();
      return response.ok ? data.url : null;
    } catch (error) {
      return null;
    }
  }

  async function addSavedLink(text) {
    let parsed = parseVideoLink(text);
    let originalUrl = String(text || '').trim();
    if (parsed && parsed.shortUrl) {
      setMotivationStatus('TikTok-Kurzlink wird aufgelöst …');
      const resolved = await resolveShortLink(parsed.shortUrl);
      parsed = resolved ? parseVideoLink(resolved) : null;
      if (resolved) originalUrl = resolved;
      if (!parsed || parsed.shortUrl) {
        setMotivationStatus('Der TikTok-Kurzlink ließ sich nicht auflösen. Öffne das Video in TikTok und kopiere den Link aus der Adresszeile.', true);
        return false;
      }
    }
    if (!parsed) {
      setMotivationStatus('Das ist kein Link zu einem Video von Instagram (Reel/Beitrag), TikTok oder YouTube (Shorts).', true);
      return false;
    }
    if (motivationData.videos.some(video => platformOf(video) === parsed.platform && video.code === parsed.code)) {
      setMotivationStatus('Dieses Video ist schon gespeichert.', true);
      return false;
    }
    // Beim Original-Link bleibt z. B. der TikTok-Nutzername erhalten ("In TikTok öffnen")
    const url = /^https?:\/\//i.test(originalUrl) && parsed.platform !== 'instagram' ? originalUrl.split('?')[0] : videoUrl(parsed);
    const video = { id: uid(), ...parsed, url, added: todayIso() };
    motivationData.videos.push(video);
    await saveMotivation();
    setMotivationStatus(`✓ ${PLATFORM_NAMES[parsed.platform]}-Video gespeichert.`);
    renderMotivationManage();
    if (!currentVideo) {
      currentVideo = video;
      $('mo-next').disabled = motivationData.videos.length < 2;
      embed(video);
    } else {
      $('mo-next').disabled = motivationData.videos.length < 2;
    }
    return true;
  }

  // ---------- Optional: live von ausgewählten Accounts ----------
  function explainProblem(error) {
    if (error === 'not-configured') {
      return ['Instagram ist noch nicht verbunden',
        'Benenne im Projektordner „instagram.vorlage.json“ in „instagram.json“ um und trag deinen Zugangsschlüssel aus der Meta-App ein – oder schalte in den Einstellungen „Videos live von Instagram-Accounts holen“ wieder aus.'];
    }
    if (error === 'no-accounts') {
      return ['Noch keine Accounts ausgewählt', 'Füge unten Instagram-Accounts hinzu, von denen du Motivationsvideos sehen willst – zum Beispiel @motivationpage.'];
    }
    if (/expired|Session has expired/i.test(error)) {
      return ['Der Instagram-Zugangsschlüssel ist abgelaufen', 'Erstelle in der Meta-App einen neuen Schlüssel und trag ihn in „instagram.json“ ein.'];
    }
    if (/Invalid OAuth|Cannot parse access token|Error validating access token/i.test(error)) {
      return ['Der Instagram-Zugangsschlüssel stimmt nicht', 'Prüfe den Eintrag „accessToken“ in „instagram.json“ – am besten den Schlüssel noch einmal aus der Meta-App kopieren.'];
    }
    if (/business_discovery|Invalid user id|Unsupported get request/i.test(error)) {
      return ['Ein Account ließ sich nicht abrufen', `Das klappt nur bei öffentlichen Creator- oder Business-Accounts. Instagram meldet: ${error}`];
    }
    return ['Gerade kein Video gefunden', `Instagram meldet: ${error}`];
  }

  async function showLiveVideo() {
    const number = ++requestNumber;
    $('mo-next').disabled = true;
    $('mo-open').hidden = true;
    $('mo-source').textContent = '';
    $('mo-stage').replaceChildren(el('div', { class: 'mo-loading', text: 'Suche ein Motivationsvideo …' }));
    let answer;
    try {
      const response = await fetch(`/api/motivation/live?exclude=${encodeURIComponent(lastPermalink)}`, { cache: 'no-store' });
      answer = await response.json();
      if (!response.ok) throw new Error(answer.error || `Fehler ${response.status}`);
    } catch (error) {
      if (number !== requestNumber) return;
      const [title, text] = explainProblem(error.message);
      showMessage(title, text, { openManage: error.message === 'no-accounts' || error.message === 'not-configured' });
      $('mo-next').disabled = !motivationData.accounts.length;
      return;
    }
    if (number !== requestNumber || $('motivation-overlay').hidden) return; // inzwischen geschlossen
    const link = parseInstagramLink(answer.permalink);
    if (!link) {
      showMessage('Gerade kein Video gefunden', 'Instagram hat einen Link geliefert, den ich nicht einbetten kann. Versuch „Anderes Video“.');
      $('mo-next').disabled = false;
      return;
    }
    currentVideo = { ...link, account: answer.account };
    lastPermalink = answer.permalink;
    embed(link, ['von ', el('strong', { text: `@${answer.account}` }),
      answer.matched || motivationData.filter === false ? '' : ' · kein eindeutiges Motivationsvideo gefunden, zufälliges Video']);
    $('mo-next').disabled = false;
  }

  async function checkInstagramStatus() {
    if (!liveMode()) return;
    let status;
    try {
      status = await fetch('/api/motivation/status', { cache: 'no-store' }).then(response => response.json());
    } catch (error) {
      status = { configured: false };
    }
    if (!status.configured) {
      setMotivationStatus('Instagram ist noch nicht verbunden (instagram.json fehlt).', true);
    } else if (status.error) {
      setMotivationStatus(`Instagram-Verbindung: ${status.error}`, true);
    } else {
      setMotivationStatus(`✓ Verbunden${status.username ? ` als @${status.username}` : ''}.`);
    }
  }

  // ---------- Overlay ----------
  function showNextVideo() {
    return liveMode() ? showLiveVideo() : showSavedVideo();
  }

  function openMotivation() {
    renderMotivationManage();
    setMotivationStatus('');
    $('mo-manage').open = false;
    $('motivation-overlay').hidden = false;
    currentVideo = null;
    showNextVideo();
  }

  // Schließen: Video anhalten (bei Live-Videos ist es damit auch vergessen)
  function closeMotivation() {
    requestNumber++;
    $('motivation-overlay').hidden = true;
    $('mo-stage').replaceChildren();
    $('mo-source').textContent = '';
    currentVideo = null;
  }

  $('motivation-tile').addEventListener('click', openMotivation);
  $('mo-next').addEventListener('click', showNextVideo);
  $('mo-close').addEventListener('click', closeMotivation);
  $('mo-manage').addEventListener('toggle', () => {
    if ($('mo-manage').open) checkInstagramStatus();
  });
  // Klick auf den abgedunkelten Rand schließt
  $('motivation-overlay').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeMotivation();
  });
  // Escape schließt zuerst das Overlay (vor allen anderen Escape-Aktionen)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('motivation-overlay').hidden) {
      event.stopImmediatePropagation();
      closeMotivation();
    }
  }, true);

  // Link speichern (Eingabe oder 📋 aus der Zwischenablage)
  $('mo-link-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (await addSavedLink($('mo-link-input').value)) $('mo-link-input').value = '';
  });
  $('mo-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      $('mo-link-input').value = text.trim();
      if (await addSavedLink(text)) $('mo-link-input').value = '';
    } catch (error) {
      setMotivationStatus('Kein Zugriff auf die Zwischenablage – füge den Link mit Strg+V ins Feld ein.', true);
      $('mo-link-input').focus();
    }
  });

  // Account hinzufügen (Live-Modus)
  $('mo-add-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('mo-add-input');
    const username = parseAccount(input.value);
    if (!username) {
      setMotivationStatus('Das ist kein gültiger Instagram-Name. Erlaubt: @name oder ein Profil-Link.', true);
      return;
    }
    if (motivationData.accounts.some(account => account.username === username)) {
      setMotivationStatus(`@${username} ist schon in der Liste.`, true);
      return;
    }
    motivationData.accounts.push({ id: uid(), username });
    input.value = '';
    await saveMotivation();
    setMotivationStatus(`✓ @${username} hinzugefügt.`);
    renderMotivationManage();
    if (!currentVideo) showLiveVideo();
  });
  $('mo-filter').addEventListener('change', () => {
    motivationData.filter = $('mo-filter').checked;
    saveMotivation();
  });

  // Einstellung umgeschaltet, während das Overlay offen ist → neu laden
  document.addEventListener('settings-changed', () => {
    if ($('motivation-overlay').hidden) return;
    renderMotivationManage();
    currentVideo = null;
    showNextVideo();
  });

  (async () => {
    const data = await motivationStore.load();
    motivationData = {
      videos: Array.isArray(data.videos) ? data.videos : [],
      lastShown: data.lastShown,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      filter: data.filter !== false
    };
  })();

  // Zum Testen in der Konsole; showMotivation nutzt auch Edith
  window.Tracker = {
    get ideas() { return ideasData; },
    get habits() { return habitsData; },
    get motivation() { return motivationData; },
    renderIdeas,
    renderHabits,
    showMotivation: openMotivation,
    winterStats,
    arcName,
    // Für Edith: kurzer Satz zum Arc
    winterSummary() {
      const name = arcName();
      if (!winterEnabled()) return `Der ${name} ist ausgeschaltet. Du kannst ihn in den Einstellungen aktivieren.`;
      const arc = winterStats();
      if (!arc.started) return `Dein ${name} ist noch nicht gestartet. Drück in der Ansicht auf „${name} starten“.`;
      const main = arc.reset ? `Du bist ${arc.counter} ${arc.counter === 1 ? 'Tag' : 'Tage'} am Stück dabei` : `Du bist an Tag ${arc.counter} von ${arc.goal}`;
      const today = journalEntry(todayIso()) ? ' Heute hast du schon abgehakt.' : ' Heute ist noch nicht abgehakt – denk an deinen Tagebuch-Eintrag.';
      return `${main} und hast ${arc.completed} ${arc.completed === 1 ? 'Tag' : 'Tage'} abgehakt. Deine aktuelle Serie: ${arc.current}.${today}`;
    },
    parseInstagramLink,
    parseVideoLink,
    parseAccount
  };
})();
