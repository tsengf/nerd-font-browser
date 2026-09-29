const $ = (selector) => document.querySelector(selector);
const state = { fonts: [], metadata: {}, selected: null, displayed: null, loadToken: 0, round: 1, decisions: {}, storageKey: null, previewSize: 16 };
const loadedFaces = new Map();
const ROUND_COUNT = 5;
const cKeywords = new Set([
  "auto", "break", "case", "const", "continue", "default", "do", "else", "enum",
  "extern", "for", "goto", "if", "register", "return", "sizeof", "static",
  "struct", "switch", "typedef", "union", "volatile", "while", "_Alignas",
  "_Alignof", "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local",
]);
const cTypes = new Set([
  "bool", "char", "double", "float", "int", "long", "short", "signed", "unsigned",
  "void", "size_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t",
  "uint16_t", "uint32_t", "uint64_t", "Point",
]);
const cTokenPattern = /\/\/.*$|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_]\w*\b|\b(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?)\w*\b|(?:>>=|<<=|==|!=|<=|>=|&&|\|\||\+\+|--|->|<<|>>|[+\-*/%=<>!&|^~?:])/g;

function cTokenClass(token, index, line) {
  if (token.startsWith("//") || token.startsWith("/*")) return "code-comment";
  if (token.startsWith('"') || token.startsWith("'")) return "code-string";
  if (cKeywords.has(token)) return "code-keyword";
  if (cTypes.has(token)) return "code-type";
  if (/^(?:0[xX][0-9A-Fa-f]+|\d)/.test(token)) return "code-number";
  if (/^[+\-*/%=<>!&|^~?:]/.test(token)) return "code-operator";
  if (/^[A-Za-z_]\w*$/.test(token) && /^\s*\(/.test(line.slice(index + token.length))) return "code-function";
  return "";
}

function renderSnippet(source) {
  const fragment = document.createDocumentFragment();
  source.split("\n").forEach((line, lineNumber) => {
    if (lineNumber) fragment.append(document.createTextNode("\n"));
    if (/^\s*#/.test(line)) {
      const directive = document.createElement("span");
      directive.className = "code-preprocessor";
      directive.textContent = line;
      fragment.append(directive);
      return;
    }
    let cursor = 0;
    for (const match of line.matchAll(cTokenPattern)) {
      if (match.index > cursor) fragment.append(document.createTextNode(line.slice(cursor, match.index)));
      const className = cTokenClass(match[0], match.index, line);
      if (className) {
        const token = document.createElement("span");
        token.className = className;
        token.textContent = match[0];
        fragment.append(token);
      } else {
        fragment.append(document.createTextNode(match[0]));
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < line.length) fragment.append(document.createTextNode(line.slice(cursor)));
  });
  return fragment;
}

async function loadSnippet() {
  try {
    const response = await fetch("/snippet.c");
    if (!response.ok) throw new Error("Could not load snippet.c");
    $("#code-sample").replaceChildren(renderSnippet(await response.text()));
  } catch (error) {
    $("#code-sample").textContent = error.message;
  }
}

function details(font) { return state.metadata[font.id] || {}; }
function fmt(value) { return Number.isFinite(value) ? value.toLocaleString() : "—"; }
function decision(identifier, round) { return state.decisions[identifier]?.[round - 1] || null; }

function isEligible(identifier, round = state.round) {
  for (let previous = 1; previous < round; previous++) {
    if (decision(identifier, previous) === "reject") return false;
  }
  return true;
}

function eligibleFonts() { return state.fonts.filter((font) => isEligible(font.id)); }

function restoreProgress(version) {
  state.storageKey = `nerd-font-browser-rounds-${version}`;
  try {
    const saved = JSON.parse(localStorage.getItem(state.storageKey));
    if (!saved || typeof saved !== "object") return;
    for (const font of state.fonts) {
      const values = saved.decisions?.[font.id];
      if (!Array.isArray(values)) continue;
      const rounds = Array.from({ length: ROUND_COUNT }, (_, index) =>
        values[index] === "accept" || values[index] === "reject" ? values[index] : null);
      for (let index = 1; index < ROUND_COUNT; index++) {
        if (rounds[index - 1] === "reject") rounds[index] = null;
      }
      state.decisions[font.id] = rounds;
    }
    if (Number.isInteger(saved.round) && saved.round >= 1 && saved.round <= ROUND_COUNT) state.round = saved.round;
    if (typeof saved.selected === "string" && state.fonts.some((font) => font.id === saved.selected)) state.selected = saved.selected;
    if (Number.isInteger(saved.previewSize) && saved.previewSize >= 12 && saved.previewSize <= 36) state.previewSize = saved.previewSize;
    if (typeof saved.customSample === "string") $("#custom-sample").value = saved.customSample;
    $("#preview-size").value = String(state.previewSize);
    $("#preview-surface").style.fontSize = `${state.previewSize}px`;
  } catch { /* Progress is still usable when local storage is unavailable. */ }
}

function saveProgress() {
  if (!state.storageKey) return;
  try {
    localStorage.setItem(state.storageKey, JSON.stringify({
      round: state.round,
      decisions: state.decisions,
      selected: state.selected,
      previewSize: state.previewSize,
      customSample: $("#custom-sample").value,
    }));
  } catch { /* Keep progress in memory when local storage is unavailable. */ }
}

function updatePreviewDetails(font) {
  const data = details(font);
  $("#preview-details").textContent = `${data.serif ? "Serif" : "Sans serif"} · ${fmt(data.glyphCount)} glyphs · ${data.heightEm ? (data.heightEm * state.previewSize).toFixed(1) + " px line height" : "Height unmeasured"}`;
}

function updateRoundView() {
  const eligible = eligibleFonts();
  const rejected = eligible.filter((font) => decision(font.id, state.round) === "reject").length;
  $("#round-summary").textContent = `Round ${state.round} · ${eligible.length} eligible · ${rejected} rejected`;
  $("#active-round-label").textContent = `ROUND ${state.round}`;
  $("#previous-round").disabled = state.round === 1;
  $("#next-round").disabled = state.round === ROUND_COUNT;

  for (const button of document.querySelectorAll(".round-switch")) {
    const active = Number(button.dataset.round) === state.round;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }

  for (const row of $("#font-list").rows) {
    const identifier = row.dataset.fontId;
    const available = isEligible(identifier);
    const button = row.querySelector(".font-option");
    button.disabled = !available;
    const selected = identifier === state.selected;
    row.classList.toggle("selected", selected);
    row.classList.toggle("ineligible", !available);
    if (selected) {
      button.setAttribute("aria-current", "true");
      button.scrollIntoView({ block: "nearest" });
    } else {
      button.removeAttribute("aria-current");
    }
    for (const cell of row.querySelectorAll(".round-result")) {
      const round = Number(cell.dataset.round);
      const result = decision(identifier, round);
      const toggle = cell.firstElementChild;
      toggle.textContent = result === "accept" ? "✓" : result === "reject" ? "×" : "·";
      toggle.disabled = !isEligible(identifier, round);
      toggle.setAttribute("aria-pressed", String(result === "reject"));
      const action = result === "reject" ? "Remove rejection" : "Reject";
      toggle.setAttribute("aria-label", `${action}: ${button.textContent}, Round ${round}`);
      toggle.title = `${action} ${button.textContent} in Round ${round}`;
      cell.dataset.result = result || "";
      cell.classList.toggle("current-round", round === state.round);
    }
  }

  const index = eligible.findIndex((font) => font.id === state.selected);
  $("#preview-position").textContent = index < 0 ? "" : `· ${index + 1} / ${eligible.length}`;
  $("#previous-font").disabled = index <= 0;
  $("#next-font").disabled = index < 0 || index >= eligible.length - 1;
  const rejectButton = $("#reject-font");
  rejectButton.disabled = index < 0 || state.displayed !== state.selected;
  rejectButton.setAttribute("aria-pressed", String(decision(state.selected, state.round) === "reject"));
}

function renderFontList() {
  const fragment = document.createDocumentFragment();
  for (const font of state.fonts) {
    const row = document.createElement("tr");
    row.dataset.fontId = font.id;
    const nameCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "font-option";
    button.textContent = font.name;
    button.addEventListener("click", () => selectFont(font.id));
    nameCell.append(button);
    row.append(nameCell);
    for (let round = 1; round <= ROUND_COUNT; round++) {
      const cell = document.createElement("td");
      cell.className = "round-result";
      cell.dataset.round = round;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "round-decision";
      toggle.addEventListener("click", () => toggleReject(font.id, round));
      cell.append(toggle);
      row.append(cell);
    }
    fragment.append(row);
  }
  $("#font-list").replaceChildren(fragment);
  $("#result-count").textContent = `${state.fonts.length} fonts`;
  $("#list-status").hidden = state.fonts.length !== 0;
  if (!state.fonts.length) $("#list-status").textContent = "No fonts available.";
  updateRoundView();
}

async function loadFont(font) {
  if (loadedFaces.has(font.id)) return loadedFaces.get(font.id);
  const promise = (async () => {
    const response = await fetch(`/api/font/${encodeURIComponent(font.id)}`);
    if (!response.ok) {
      let message = `Font download failed (${response.status})`;
      try { message = (await response.json()).error || message; } catch { /* Keep status. */ }
      throw new Error(message);
    }
    const bytes = await response.arrayBuffer();
    const face = new FontFace(`preview-${font.id}`, bytes);
    await face.load();
    document.fonts.add(face);
    return face.family;
  })();
  loadedFaces.set(font.id, promise);
  try { return await promise; }
  catch (error) { loadedFaces.delete(font.id); throw error; }
}

async function selectFont(identifier) {
  const font = state.fonts.find((item) => item.id === identifier);
  if (!font || !isEligible(identifier)) return;
  state.selected = identifier;
  const token = ++state.loadToken;
  saveProgress();
  updateRoundView();
  if (!state.displayed) $("#preview-status").textContent = `Loading ${font.name}…`;
  try {
    const family = await loadFont(font);
    if (token !== state.loadToken) return;
    state.displayed = identifier;
    const data = details(font);
    $("#preview-name").textContent = font.name;
    $("#preview-surface").style.fontFamily = `"${family}", ui-monospace, monospace`;
    $("#preview-surface").style.lineHeight = data.heightEm || "normal";
    $("#preview-surface").hidden = false;
    $("#preview-status").textContent = "Font ready";
    $("#download-link").href = font.downloadUrl;
    $("#download-link").hidden = false;
    updatePreviewDetails(font);
    updateRoundView();
  } catch (error) {
    if (token !== state.loadToken) return;
    state.selected = state.displayed ?? identifier;
    saveProgress();
    $("#preview-status").textContent = error.message;
    updateRoundView();
  }
}

function movePreview(direction) {
  const eligible = eligibleFonts();
  const index = eligible.findIndex((font) => font.id === state.selected);
  const next = eligible[index + direction];
  if (index >= 0 && next) selectFont(next.id);
}

function chooseRound(round) {
  if (!state.fonts.length || round < 1 || round > ROUND_COUNT || round === state.round) return;
  state.round = round;
  state.loadToken++;
  state.selected = null;
  state.displayed = null;
  saveProgress();
  $("#preview-surface").hidden = true;
  $("#download-link").hidden = true;
  $("#preview-details").textContent = "";
  const eligible = eligibleFonts();
  updateRoundView();
  if (eligible.length) {
    const next = eligible.find((font) => !decision(font.id, round)) || eligible[0];
    selectFont(next.id);
  } else {
    $("#preview-name").textContent = `Round ${round}`;
    $("#preview-status").textContent = `No fonts remain for Round ${round}.`;
  }
}

function toggleReject(identifier, round) {
  if (!identifier || !isEligible(identifier, round)) return;
  const rounds = state.decisions[identifier] || Array(ROUND_COUNT).fill(null);
  const rejected = rounds[round - 1] !== "reject";
  rounds[round - 1] = rejected ? "reject" : null;
  if (rejected) rounds.fill(null, round);
  state.decisions[identifier] = rounds;
  saveProgress();
  if (!state.selected || !isEligible(state.selected)) {
    state.loadToken++;
    state.selected = null;
    state.displayed = null;
    saveProgress();
    $("#preview-surface").hidden = true;
    $("#download-link").hidden = true;
    $("#preview-details").textContent = "";
    const eligible = eligibleFonts();
    updateRoundView();
    if (eligible.length) {
      const next = eligible.find((font) => !decision(font.id, state.round)) || eligible[0];
      selectFont(next.id);
    } else {
      $("#preview-name").textContent = `Round ${state.round}`;
      $("#preview-status").textContent = `No fonts remain for Round ${state.round}.`;
    }
    return;
  }
  if (identifier === state.selected && round === state.round) {
    $("#preview-status").textContent = rejected ? `Rejected in Round ${round}` : `Rejection removed in Round ${round}`;
  }
  updateRoundView();
}

async function start() {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error(`Catalog unavailable (${response.status})`);
    const catalog = await response.json();
    state.fonts = catalog.fonts;
    state.metadata = catalog.metadata;
    restoreProgress(catalog.version);
    $("#catalog-version").textContent = `Nerd Fonts ${catalog.version}`;
    renderFontList();
    const eligible = eligibleFonts();
    if (eligible.length) {
      const next = eligible.find((font) => font.id === state.selected)
        || eligible.find((font) => !decision(font.id, state.round)) || eligible[0];
      selectFont(next.id);
    } else if (state.round > 1) {
      $("#preview-name").textContent = `Round ${state.round}`;
      $("#preview-status").textContent = `No fonts remain for Round ${state.round}.`;
    }
  } catch (error) {
    $("#catalog-version").textContent = "Catalog unavailable";
    $("#list-status").textContent = error.message;
    $("#preview-status").textContent = "Could not load the catalog. Restart the local server and reload this page.";
  }
}

document.querySelectorAll(".round-switch").forEach((button) =>
  button.addEventListener("click", () => chooseRound(Number(button.dataset.round))));
$("#previous-round").addEventListener("click", () => chooseRound(state.round - 1));
$("#next-round").addEventListener("click", () => chooseRound(state.round + 1));
$("#reject-font").addEventListener("click", () => toggleReject(state.selected, state.round));
$("#previous-font").addEventListener("click", () => movePreview(-1));
$("#next-font").addEventListener("click", () => movePreview(1));
function applyPreviewSize() {
  const input = $("#preview-size");
  const size = Number(input.value);
  if (!input.value || !Number.isInteger(size) || size < 12 || size > 36) return;
  state.previewSize = size;
  $("#preview-surface").style.fontSize = `${size}px`;
  const font = state.fonts.find((item) => item.id === state.displayed);
  if (font) updatePreviewDetails(font);
  saveProgress();
}
$("#preview-size").addEventListener("input", applyPreviewSize);
$("#preview-size").addEventListener("change", (event) => {
  const input = event.target;
  const entered = Number(input.value);
  input.value = String(input.value && Number.isFinite(entered)
    ? Math.min(36, Math.max(12, Math.round(entered))) : state.previewSize);
  applyPreviewSize();
});
$("#custom-sample").addEventListener("input", saveProgress);
document.addEventListener("keydown", (event) => {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.matches("textarea, input, select") || event.target.isContentEditable) return;
  if (!state.fonts.length) return;
  event.preventDefault();
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (!event.repeat) chooseRound(state.round + (event.key === "ArrowLeft" ? -1 : 1));
  } else if (state.selected) movePreview(event.key === "ArrowUp" ? -1 : 1);
});
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "x" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.matches("textarea, input") || event.target.isContentEditable) return;
  if (!state.selected || state.displayed !== state.selected) return;
  event.preventDefault();
  toggleReject(state.selected, state.round);
});
loadSnippet();
start();
