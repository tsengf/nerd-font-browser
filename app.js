const $ = (selector) => document.querySelector(selector);
const state = { fonts: [], visible: [], metadata: {}, selected: null, sort: "name", descending: false, loadToken: 0 };
const loadedFaces = new Map();
const controls = ["#search", "#serif-filter", "#glyph-filter", "#glyph-min", "#height-max"];

function details(font) { return state.metadata[font.id] || {}; }
function fmt(value) { return Number.isFinite(value) ? value.toLocaleString() : "—"; }

function filteredFonts() {
  const search = $("#search").value.trim().toLowerCase();
  const serif = $("#serif-filter").value;
  const glyphs = $("#glyph-filter").value;
  const minGlyphs = Number($("#glyph-min").value);
  const maxHeight = Number($("#height-max").value);
  const useMin = $("#glyph-min").value !== "";
  const useMax = $("#height-max").value !== "";
  const filtered = state.fonts.filter((font) => {
    const data = details(font);
    if (!font.name.toLowerCase().includes(search)) return false;
    if (serif !== "any" && data.serif !== (serif === "yes")) return false;
    // Every catalog entry is a patched Nerd Font and includes Nerd icon glyphs.
    if (glyphs === "no") return false;
    if (useMin && !(data.glyphCount >= minGlyphs)) return false;
    if (useMax && !(data.heightEm * 16 <= maxHeight)) return false;
    return true;
  });
  const compare = (a, b) => {
    const aa = details(a), bb = details(b);
    let result = 0;
    if (state.sort === "name") result = a.name.localeCompare(b.name);
    else if (state.sort === "serif") result = Number(aa.serif) - Number(bb.serif);
    else if (state.sort === "glyphCount") result = (aa.glyphCount ?? -1) - (bb.glyphCount ?? -1);
    else if (state.sort === "height") result = (aa.heightEm ?? -1) - (bb.heightEm ?? -1);
    return (state.descending ? -1 : 1) * (result || a.name.localeCompare(b.name));
  };
  return filtered.sort(compare);
}

function render() {
  state.visible = filteredFonts();
  const tbody = $("#font-rows");
  tbody.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const font of state.visible) {
    const data = details(font);
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "font-name";
    button.textContent = font.name;
    button.addEventListener("click", () => openPreview(font.id));
    nameCell.append(button);
    const serifCell = document.createElement("td");
    serifCell.textContent = data.serif === undefined ? "—" : data.serif ? "Yes" : "No";
    const glyphCell = document.createElement("td");
    glyphCell.innerHTML = '<span class="yes-dot"></span> Yes';
    const countCell = document.createElement("td");
    countCell.textContent = fmt(data.glyphCount);
    const heightCell = document.createElement("td");
    heightCell.textContent = data.heightEm ? `${(data.heightEm * 16).toFixed(1)} px` : "—";
    row.append(nameCell, serifCell, glyphCell, countCell, heightCell);
    fragment.append(row);
  }
  tbody.append(fragment);
  const count = `${state.visible.length} of ${state.fonts.length} fonts`;
  $("#result-count").textContent = count;
  $("#footer-count").textContent = count;
  $("#empty-state").hidden = state.visible.length !== 0;
  if ($("#preview").open) updatePreviewPosition();
}

function updatePreviewPosition() {
  const index = state.visible.findIndex((font) => font.id === state.selected);
  $("#preview-position").textContent = index < 0 ? "· Outside current filters" : `· ${index + 1} / ${state.visible.length}`;
  $("#previous-font").disabled = index <= 0;
  $("#next-font").disabled = index < 0 || index >= state.visible.length - 1;
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

async function openPreview(identifier) {
  const font = state.fonts.find((item) => item.id === identifier);
  if (!font) return;
  state.selected = identifier;
  const token = ++state.loadToken;
  const dialog = $("#preview");
  if (!dialog.open) dialog.showModal();
  $("#preview-name").textContent = font.name;
  $("#preview-status").textContent = "Loading font…";
  $("#preview-surface").style.fontFamily = "ui-monospace, monospace";
  $("#download-link").href = font.downloadUrl;
  const data = details(font);
  $("#preview-details").textContent = `${data.serif ? "Serif" : "Sans serif"} · ${fmt(data.glyphCount)} glyphs · ${data.heightEm ? (data.heightEm * 16).toFixed(1) + " px line height" : "Height unmeasured"}`;
  updatePreviewPosition();
  try {
    const family = await loadFont(font);
    if (token !== state.loadToken || !dialog.open) return;
    $("#preview-surface").style.fontFamily = `"${family}", ui-monospace, monospace`;
    $("#preview-status").textContent = "Font ready · Use ↑ ↓ to browse visible fonts";
  } catch (error) {
    if (token === state.loadToken) $("#preview-status").textContent = error.message;
  }
}

function movePreview(direction) {
  const index = state.visible.findIndex((font) => font.id === state.selected);
  const next = state.visible[index + direction];
  if (index >= 0 && next) openPreview(next.id);
}

async function start() {
  try {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error(`Catalog unavailable (${response.status})`);
    const catalog = await response.json();
    state.fonts = catalog.fonts;
    state.metadata = catalog.metadata;
    $("#catalog-version").textContent = `Nerd Fonts ${catalog.version}`;
    render();
  } catch (error) {
    $("#catalog-version").textContent = error.message;
    $("#empty-state").hidden = false;
    $("#empty-state").textContent = "Could not load the catalog. Restart the local server and reload this page.";
  }
}

for (const selector of controls) $(selector).addEventListener("input", render);
$("#clear-filters").addEventListener("click", () => {
  $("#search").value = "";
  $("#serif-filter").value = "any";
  $("#glyph-filter").value = "any";
  $("#glyph-min").value = "";
  $("#height-max").value = "";
  render();
});
document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
  const key = button.dataset.sort;
  state.descending = state.sort === key ? !state.descending : false;
  state.sort = key;
  render();
}));
$("#close-preview").addEventListener("click", () => $("#preview").close());
$("#preview").addEventListener("close", () => { state.loadToken++; });
$("#previous-font").addEventListener("click", () => movePreview(-1));
$("#next-font").addEventListener("click", () => movePreview(1));
$("#preview-size").addEventListener("input", (event) => {
  const size = event.target.value;
  $("#preview-surface").style.fontSize = `${size}px`;
  $("#size-value").value = `${size} px`;
});
document.addEventListener("keydown", (event) => {
  if (!$("#preview").open || event.target.matches("textarea, input")) return;
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    movePreview(event.key === "ArrowUp" ? -1 : 1);
  }
});
start();
