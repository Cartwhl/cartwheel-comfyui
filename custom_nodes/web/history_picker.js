export class HistoryPicker {
  constructor(node, fetchPage, options = {}) {
    this.node = node;
    this.fetchPage = fetchPage;
    this.options = options;
    this.widget = node.widgets.find((widget) => widget.name === "motion_id");
    this.items = new Map();
    this.tokens = new Set();
    this.element = document.createElement("div");
    this.element.className = "cartwheel-history";
    this.element.innerHTML = `<div class="cwh-toolbar"><strong>Cartwheel API history</strong><button class="cwh-refresh">Refresh history</button></div><select class="cwh-list" size="6" aria-label="Cartwheel captures"></select><div class="cwh-footer"><button class="cwh-more" disabled>Load more</button><span class="cwh-status" role="status"></span></div><div class="cwh-selected"></div>`;
    this.source = node.properties.cartwheel_history_tab ?? "all";
    this.tabs = document.createElement("div"); this.tabs.className="cwh-tabs"; this.tabs.setAttribute("role","tablist");
    this.tabButtons=new Map();
    for (const [key,title] of [["all","All"],["performance","Performance Capture"],["swing","Swing Choreo"]]) {
      const button=document.createElement("button"); button.textContent=title;button.setAttribute("role","tab");
      button.onclick=()=>{this.source=key;node.properties.cartwheel_history_tab=key;this.drawList();};
      this.tabs.append(button);this.tabButtons.set(key,button);
    }
    this.filter=document.createElement("input");this.filter.type="search";this.filter.placeholder="Filter loaded titles / prompts";
    this.filter.setAttribute("aria-label","Filter loaded history titles or prompts");this.filter.oninput=()=>this.drawList();
    this.element.querySelector(".cwh-toolbar").after(this.tabs,this.filter);
    this.list = this.element.querySelector(".cwh-list");
    this.refresh = this.element.querySelector(".cwh-refresh");
    this.more = this.element.querySelector(".cwh-more");
    this.status = this.element.querySelector(".cwh-status");
    this.selected = this.element.querySelector(".cwh-selected");
    if (options.title) this.element.querySelector("strong").textContent = options.title;
    if (options.listLabel) this.list.setAttribute("aria-label", options.listLabel);
    for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "dblclick", "keydown"]) this.element.addEventListener(type, (event) => event.stopPropagation());
    this.refresh.onclick = () => this.load(true);
    this.more.onclick = () => this.load(false);
    this.list.onchange = () => {
      const item = this.items.get(this.list.value);
      if (!item || item.status !== "COMPLETED" || (options.requireGLB && !item.glb_compatible) || (options.acceptItem && !options.acceptItem(item))) return;
      this.widget.value = item.motion_id;
      this.node.properties.cartwheel_history_selection = item;
      this.showSelection(item);
      this.node.graph?.setDirtyCanvas(true, true);
      options.onSelect?.(item);
    };
    this.restore();
  }

  showSelection(item) {
    if(this.options.requireGLB) {
      this.selected.textContent=item?(item.glb_compatible===false?"This saved job has no complete GLB export. Refresh history and choose a GLB job.":`Selected: ${item.title}${item.glb_compatible?" · GLB":" · refresh history to verify GLB"}. Run to load.`):"Choose a completed GLB job, then Run.";
      return;
    }
    if (this.options.selectionText) { this.selected.textContent = this.options.selectionText(item); return; }
    this.selected.textContent = item ? `Selected: ${item.title}. ${item.has_camera && item.has_native_actors ? "Actors and captured camera available." : ""}${!item.has_camera ? " No captured camera." : ""}${!item.has_native_actors ? " GLB playback is used when available." : ""} Run the workflow to load.` : "Choose a completed capture, then run the workflow.";
  }

  restore() {
    const saved = this.node.properties.cartwheel_history_selection;
    this.showSelection(saved?.motion_id === this.widget.value ? saved : null);
    if (this.widget.value && saved?.motion_id !== this.widget.value) this.selected.textContent = `Saved capture: ${this.widget.value}. Run to load it, or refresh history to choose another.`;
    this.status.textContent = this.options.requireGLB?"GLB exports only · uses your saved Cartwheel connection.":"Uses your saved Cartwheel connection.";
  }

  drawList() {
    this.list.replaceChildren();
    for(const [key,button] of this.tabButtons)button.setAttribute("aria-selected",String(key===this.source));
    const query=this.filter.value.trim().toLowerCase();
    const visible=[...this.items.values()].filter(item=>(!this.options.requireGLB||item.glb_compatible)&&(this.source==="all"||item.source_kind===this.source)&&(!query||item.title.toLowerCase().includes(query)));
    for (const item of visible) {
      const option = document.createElement("option");
      option.value = item.motion_id;
      option.disabled = item.status !== "COMPLETED" || Boolean(this.options.acceptItem && !this.options.acceptItem(item));
      const date = new Date(item.created_at);
      const when = Number.isNaN(date.getTime()) ? item.created_at : date.toLocaleString();
      option.textContent = `${item.title} · ${when} · ${item.status === "COMPLETED" ? `${item.actors} actor${item.actors === 1 ? "" : "s"}${item.glb_compatible?" · GLB":""} · ${item.has_camera ? "camera" : "no camera"}` : item.status}`;
      option.title = option.textContent;
      this.list.append(option);
    }
    this.list.value = this.widget.value || "";
    this.status.textContent=`${this.options.requireGLB?"GLB only · ":""}${visible.length} shown · ${this.items.size} loaded${this.nextToken?" · more available":""}${[...this.items.values()].some(i=>!i.source_kind||i.source_kind==="unknown")?" · unclassified entries remain in All":""}`;
  }

  async load(reset) {
    if (this.busy || this.disposed || (!reset && !this.nextToken)) return;
    this.busy = true;
    this.refresh.disabled = this.more.disabled = true;
    this.status.textContent = "Loading history…";
    const requestedToken = reset ? null : this.nextToken;
    this.controller = new AbortController();
    try {
      const page = await this.fetchPage(requestedToken, this.controller.signal);
      if (this.disposed) return;
      const changed = this.connection && page.connection !== this.connection;
      if (changed && !reset) throw new Error("Cartwheel connection changed. Click Refresh history.");
      if (reset || changed) { this.items.clear(); this.tokens.clear(); }
      if (changed) {
        this.widget.value = "";
        delete this.node.properties.cartwheel_history_selection;
        this.showSelection(null);
      }
      this.connection = page.connection;
      for (const item of page.items) this.items.set(item.motion_id, item);
      this.nextToken = page.next_token;
      if (this.nextToken && this.tokens.has(this.nextToken)) {
        this.nextToken = null;
        throw new Error("History returned a repeated page. Click Refresh history.");
      }
      if (this.nextToken) this.tokens.add(this.nextToken);
      this.drawList();
      const selected = this.items.get(this.widget.value);
      if (selected) {
        this.node.properties.cartwheel_history_selection = selected;
        this.showSelection(selected);
      }
      if(!this.items.size)this.status.textContent=this.options.requireGLB?(this.nextToken?"No GLB jobs on these pages · Load more to continue.":"No GLB jobs found for this API account."):"No motions found for this API account.";
    } catch (error) {
      if (!this.disposed && error.name !== "AbortError") this.status.textContent = error.message;
    } finally {
      this.busy = false;
      this.refresh.disabled = false;
      this.more.disabled = !this.nextToken;
    }
  }

  dispose() { this.disposed = true; this.controller?.abort(); this.element.remove(); }
}
