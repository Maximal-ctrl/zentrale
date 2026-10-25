// Zentrale: Anmeldung mit Account-Code und Speichern der Daten im privaten GitHub-Repo
//
// konto.js (von einrichtung.html erzeugt) enthält Repo-Angaben und pro Account den GitHub-Schlüssel,
// verschlüsselt mit dessen 5-stelligem Code. Beim Öffnen fragt die Seite nach dem Code; passt er zu
// einem Account, werden dessen Daten aus daten/<account>/<name>.json im Daten-Repo geladen.
//
// Die übrigen Skripte sprechen weiter "/api/termine", "/api/einstellungen" usw. an – diese Aufrufe
// werden hier abgefangen und an GitHub weitergeleitet. So läuft die Seite auch auf GitHub Pages.
(() => {
  'use strict';

  const KONTO = window.ZENTRALE_KONTO || null;
  const STORES = {
    termine: '[]',
    einstellungen: '{}',
    ideen: '{"folders":[],"ideas":[]}',
    gewohnheiten: '{"habits":[]}',
    motivation: '{"videos":[],"accounts":[],"filter":true}'
  };
  const REMEMBER_KEY = 'zentrale-anmeldung';
  const SAVE_DELAY = 1200;      // ms: mehrere Änderungen kurz hintereinander = ein Speichervorgang
  const RETRY_DELAY = 10000;    // ms: nach einem Fehler erneut versuchen

  const nativeFetch = window.fetch.bind(window);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let session = null;           // { id, name, token }
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const files = {};             // name -> { sha, text, dirty, saving, timer, loadFailed }
  let lastError = '';

  // ---------- Hilfen: Base64 und Verschlüsselung ----------
  function bytesToB64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }
  const b64ToBytes = text => Uint8Array.from(atob(text.replace(/\s/g, '')), char => char.charCodeAt(0));
  const utf8ToB64 = text => bytesToB64(encoder.encode(text));
  const b64ToUtf8 = text => decoder.decode(b64ToBytes(text));

  async function deriveKey(code, salt, iterations) {
    const base = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  // Probiert den Code an jedem Account; nur beim richtigen lässt sich der Schlüssel entschlüsseln
  async function unlock(code) {
    for (const account of KONTO.accounts) {
      try {
        const key = await deriveKey(code, b64ToBytes(account.salt), KONTO.iterations);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(account.iv) }, key, b64ToBytes(account.token));
        return { id: account.id, name: account.name, token: decoder.decode(plain) };
      } catch (error) {
        // falscher Code für diesen Account
      }
    }
    return null;
  }

  // ---------- GitHub ----------
  const contentsUrl = name => `https://api.github.com/repos/${KONTO.owner}/${KONTO.repo}/contents/daten/${session.id}/${name}.json`;

  function github(url, options = {}) {
    return nativeFetch(url, {
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${session.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
  }

  function describeStatus(status) {
    if (status === 401) return 'GitHub-Schlüssel ungültig oder abgelaufen – bitte neu einrichten.';
    if (status === 403) return 'GitHub verweigert den Zugriff (Rechte des Schlüssels oder zu viele Anfragen).';
    if (status === 404) return 'Daten-Repo nicht gefunden – stimmt die Einrichtung?';
    return `GitHub-Fehler ${status}.`;
  }

  // Lädt Inhalt + sha einer Datei (fehlt sie noch, gilt der leere Startwert)
  async function fetchFile(name) {
    const response = await github(`${contentsUrl(name)}?ref=${encodeURIComponent(KONTO.branch)}`);
    if (response.status === 404) return { sha: null, text: STORES[name] };
    if (!response.ok) throw new Error(describeStatus(response.status));
    const json = await response.json();
    let text = json.content ? b64ToUtf8(json.content) : '';
    if (!text && json.size > 0) {
      // große Dateien (> 1 MB) liefert GitHub nur ohne Inhalt – dann roh nachladen
      const raw = await github(`${contentsUrl(name)}?ref=${encodeURIComponent(KONTO.branch)}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!raw.ok) throw new Error(describeStatus(raw.status));
      text = await raw.text();
    }
    return { sha: json.sha, text: text || STORES[name] };
  }

  async function readStore(name) {
    const file = files[name] || (files[name] = {});
    if (file.text !== undefined && !file.loadFailed) return file.text;
    let lastProblem;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { sha, text } = await fetchFile(name);
        file.sha = sha;
        file.text = text;
        file.loadFailed = false;
        return text;
      } catch (error) {
        lastProblem = error;
      }
    }
    // Nicht laden können heißt: auch nicht speichern, sonst würden die echten Daten überschrieben
    file.loadFailed = true;
    setError(`${lastProblem.message || 'Keine Verbindung zu GitHub.'} (${name} konnte nicht geladen werden)`);
    throw lastProblem;
  }

  function writeFile(name, text, sha, keepalive) {
    const body = JSON.stringify({
      message: `${session.name}: ${name} gespeichert`,
      content: utf8ToB64(text),
      branch: KONTO.branch,
      ...(sha ? { sha } : {})
    });
    return github(contentsUrl(name), { method: 'PUT', body, keepalive: keepalive && body.length < 60000 });
  }

  function queueSave(name, text) {
    const file = files[name] || (files[name] = {});
    if (file.loadFailed) {
      setError(`${name} wurde nicht geladen – Speichern ist gesperrt, damit nichts überschrieben wird. Seite neu laden.`);
      return false;
    }
    file.text = text;
    file.dirty = true;
    clearTimeout(file.timer);
    file.timer = setTimeout(() => flush(name), SAVE_DELAY);
    renderStatus();
    return true;
  }

  async function flush(name, keepalive = false) {
    const file = files[name];
    if (!file || !file.dirty) return;
    clearTimeout(file.timer);
    if (file.saving) {
      file.again = true;
      return;
    }
    file.saving = true;
    file.dirty = false;
    const text = file.text;
    renderStatus();
    try {
      let response = await writeFile(name, text, file.sha, keepalive);
      if (response.status === 409 || response.status === 422) {
        // jemand (z. B. ein anderes Gerät) hat die Datei zwischendurch gespeichert → aktuellen sha holen
        const current = await fetchFile(name);
        file.sha = current.sha;
        response = await writeFile(name, text, file.sha, keepalive);
      }
      if (!response.ok) throw new Error(describeStatus(response.status));
      const json = await response.json();
      file.sha = json.content && json.content.sha;
      lastError = '';
    } catch (error) {
      file.dirty = true;
      setError(error.message || 'Speichern fehlgeschlagen – keine Verbindung?');
      file.timer = setTimeout(() => flush(name), RETRY_DELAY);
    } finally {
      file.saving = false;
      if (file.again) {
        file.again = false;
        if (file.dirty) flush(name);
      }
      renderStatus();
    }
  }

  const unsaved = () => Object.values(files).some(file => file.dirty || file.saving);

  // Beim Wegklicken/Schließen sofort speichern
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') Object.keys(files).forEach(name => flush(name, true));
  });
  window.addEventListener('beforeunload', event => {
    if (!unsaved()) return;
    Object.keys(files).forEach(name => flush(name, true));
    event.preventDefault();
    event.returnValue = '';
  });

  // ---------- Abfangen der /api/...-Aufrufe ----------
  const jsonResponse = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const match = /^\/api\/([a-z/-]+)/.exec(url);
    if (!match) return nativeFetch(input, init);
    const name = match[1];

    // Hintergrundbilder: feste Liste statt Ordner-Abfrage
    if (name === 'hintergruende') return nativeFetch('hintergruende.json', { cache: 'no-cache' });

    if (Object.prototype.hasOwnProperty.call(STORES, name)) {
      await ready;
      if (String(init.method || 'GET').toUpperCase() === 'POST') {
        JSON.parse(init.body); // ungültiges JSON nie speichern
        return queueSave(name, init.body) ? jsonResponse(init.body) : jsonResponse('{"error":"locked"}', 409);
      }
      try {
        return jsonResponse(await readStore(name));
      } catch (error) {
        return jsonResponse(JSON.stringify({ error: error.message }), 502);
      }
    }

    // Live-Instagram und TikTok-Kurzlinks brauchten den lokalen Server – online gibt es sie nicht
    if (name === 'motivation/status') return jsonResponse('{"configured":false}');
    return jsonResponse(JSON.stringify({ error: 'Diese Funktion gibt es in der Online-Version nicht. Bitte den vollen Video-Link verwenden.' }), 501);
  };

  // ---------- Anmeldefenster ----------
  function setError(message) {
    lastError = message;
    renderStatus();
  }

  function renderStatus() {
    const status = document.getElementById('account-status');
    if (!status) return;
    let text = 'Alles gespeichert ✓';
    let state = 'ok';
    if (lastError) {
      text = `⚠ ${lastError}`;
      state = 'error';
    } else if (unsaved()) {
      text = 'Speichert …';
      state = 'pending';
    }
    status.textContent = text;
    status.dataset.state = state;
    const badge = document.getElementById('save-badge');
    if (badge) {
      badge.hidden = state === 'ok';
      badge.textContent = state === 'error' ? '⚠ Nicht gespeichert' : 'Speichert …';
      badge.dataset.state = state;
      badge.title = text;
    }
  }

  function readRemembered() {
    try {
      const stored = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
      return stored && /^\d{5}$/.test(stored.code) ? stored.code : null;
    } catch (error) {
      return null;
    }
  }

  function remember(code) {
    try {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ code }));
    } catch (error) {
      // ohne Speicher: beim nächsten Öffnen einfach erneut fragen
    }
  }

  function forget() {
    try {
      localStorage.removeItem(REMEMBER_KEY);
    } catch (error) {
      // nichts zu tun
    }
  }

  function finishLogin(account) {
    session = account;
    document.body.classList.remove('login-open');
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.remove();
    const name = document.getElementById('account-name');
    if (name) name.textContent = account.name;
    const avatar = document.getElementById('account-avatar');
    if (avatar) avatar.textContent = account.name.charAt(0).toUpperCase();
    renderStatus();
    resolveReady();
    document.dispatchEvent(new CustomEvent('account-ready', { detail: { id: account.id, name: account.name } }));
  }

  function showLogin(message) {
    document.body.classList.add('login-open');
    const overlay = document.createElement('div');
    overlay.className = 'login-overlay';
    overlay.id = 'login-overlay';
    overlay.innerHTML = `
      <form class="login-card glass" autocomplete="off">
        <div class="login-logo">🔒</div>
        <h1>Zentrale</h1>
        <p class="login-hint">Gib deinen 5-stelligen Account-Code ein.</p>
        <input class="login-code" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="5"
          aria-label="Account-Code" placeholder="•••••">
        <label class="login-remember"><input type="checkbox" checked> Auf diesem Gerät angemeldet bleiben</label>
        <button type="submit" class="login-button">Anmelden</button>
        <p class="login-message" aria-live="polite"></p>
      </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const input = overlay.querySelector('.login-code');
    const rememberBox = overlay.querySelector('.login-remember input');
    const button = overlay.querySelector('.login-button');
    const messageBox = overlay.querySelector('.login-message');
    messageBox.textContent = message || '';
    let failures = 0;

    if (!KONTO || !Array.isArray(KONTO.accounts) || !KONTO.accounts.length) {
      input.disabled = true;
      button.disabled = true;
      messageBox.textContent = 'Die Zentrale ist noch nicht eingerichtet (konto.js fehlt). Öffne einrichtung.html über start.bat.';
      return;
    }

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
      if (input.value.length === 5) form.requestSubmit();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const code = input.value;
      if (!/^\d{5}$/.test(code)) {
        messageBox.textContent = 'Der Code hat 5 Ziffern.';
        return;
      }
      input.disabled = true;
      button.disabled = true;
      messageBox.textContent = 'Prüfe Code …';
      const account = await unlock(code);
      if (account) {
        if (rememberBox.checked) remember(code);
        else forget();
        finishLogin(account);
        return;
      }
      failures++;
      // nach mehreren Fehlversuchen etwas warten lassen
      const wait = failures >= 3 ? Math.min(30, 2 ** (failures - 2)) : 0;
      messageBox.textContent = wait ? `Falscher Code. Nächster Versuch in ${wait} s.` : 'Falscher Code.';
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      setTimeout(() => {
        input.disabled = false;
        button.disabled = false;
        input.value = '';
        input.focus();
        if (wait) messageBox.textContent = 'Falscher Code.';
      }, wait * 1000);
    });
    setTimeout(() => input.focus(), 50);
  }

  async function start() {
    const remembered = KONTO ? readRemembered() : null;
    if (remembered) {
      const account = await unlock(remembered);
      if (account) {
        finishLogin(account);
        return;
      }
      forget();
    }
    showLogin();
  }

  // Einstellungen: Account anzeigen, abmelden
  function wireAccountSection() {
    const logout = document.getElementById('account-logout');
    if (!logout) return;
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = 'Speichert …';
      await Promise.all(Object.keys(files).map(name => flush(name)));
      forget();
      location.reload();
    });
  }

  function init() {
    wireAccountSection();
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Speicher = {
    ready,
    get account() { return session ? { id: session.id, name: session.name } : null; },
    unsaved
  };
})();
