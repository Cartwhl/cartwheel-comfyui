import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "Cartwheel.Connection",
  settings: [
    {
      // Preserve existing production keys without exposing server selection.
      id: "Cartwheel.Connection.ProductionApiKey",
      name: "API key",
      type: "text",
      defaultValue: "",
      attrs: { type: "password", autocomplete: "off", spellcheck: false },
      tooltip: "Your Cartwheel API key. Connects to the production API. Saved outside workflows in this local ComfyUI server's settings; use a trusted single-user server.",
    },
  ],
});
