import * as vscode from "vscode";
import { getNonce } from "./core";

export function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }

      button {
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 4px;
        padding: 7px 10px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        font: inherit;
        cursor: pointer;
      }

      button.secondary {
        color: var(--vscode-foreground);
        background: var(--vscode-input-background);
        border-color: var(--vscode-input-border, transparent);
      }

      .shell {
        display: grid;
        gap: 14px;
        padding: 14px;
      }

      .topbar,
      .actions,
      .meta,
      .crumb-head {
        display: flex;
        gap: 8px;
      }

      .topbar,
      .crumb-head {
        align-items: flex-start;
        justify-content: space-between;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font-size: 18px;
        letter-spacing: 0;
      }

      .status {
        min-width: 8px;
        height: 8px;
        margin-top: 7px;
        border-radius: 999px;
        background: var(--vscode-testing-iconQueued);
      }

      .status.on {
        background: var(--vscode-testing-iconPassed);
      }

      .card {
        border: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
        border-radius: 6px;
        padding: 12px;
        background: var(--vscode-editor-background);
      }

      .setup {
        display: grid;
        gap: 10px;
      }

      .setup-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .setup-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .line {
        overflow-wrap: anywhere;
        color: var(--vscode-textPreformat-foreground);
        font-family: var(--vscode-editor-font-family);
        line-height: 1.45;
        white-space: pre-wrap;
      }

      .explanation {
        margin-top: 10px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.55;
        white-space: pre-wrap;
      }

      .meta {
        flex-wrap: wrap;
        margin-top: 10px;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }

      .pill {
        border: 1px solid var(--vscode-badge-background);
        border-radius: 999px;
        padding: 2px 7px;
      }

      .pill.connected {
        color: var(--vscode-testing-iconPassed);
        border-color: var(--vscode-testing-iconPassed);
      }

      .pill.missing {
        color: var(--vscode-testing-iconQueued);
        border-color: var(--vscode-testing-iconQueued);
      }

      .explanation.error {
        color: var(--vscode-errorForeground);
      }

      .history {
        display: grid;
        gap: 8px;
      }

      .crumb {
        border-left: 2px solid var(--vscode-focusBorder);
      }

      .crumb h3 {
        max-width: 70%;
        overflow: hidden;
        font-size: 12px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .small {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }

      .empty {
        border: 1px dashed var(--vscode-panel-border);
        border-radius: 6px;
        padding: 18px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="topbar">
        <div>
          <h1>Breadcrumbs</h1>
          <p class="small" id="modeLabel">Watching cursor</p>
        </div>
        <span class="status" id="statusDot" aria-hidden="true"></span>
      </section>

      <section class="actions">
        <button id="explainButton" type="button">Explain</button>
        <button id="toggleButton" class="secondary" type="button">Auto</button>
        <button id="clearButton" class="secondary" type="button">Clear</button>
      </section>

      <section class="card setup" aria-label="Provider account setup">
        <div class="setup-row">
          <div>
            <p class="small">AI provider</p>
            <h2 id="providerName">Gemini</h2>
          </div>
          <span class="pill" id="connectionStatus">Not connected</span>
        </div>
        <p class="small" id="connectionHelp">Connect a provider key to generate explanations.</p>
        <div class="setup-actions">
          <button id="providerButton" class="secondary" type="button">Choose</button>
          <button id="keyButton" type="button">Connect</button>
        </div>
        <button id="disconnectButton" class="secondary" type="button">Disconnect key</button>
      </section>

      <section class="card" id="activeCard">
        <p class="small">Current line</p>
        <p class="line" id="activeLine">Move your cursor inside a code file.</p>
        <p class="explanation" id="activeExplanation"></p>
        <div class="meta" id="activeMeta"></div>
      </section>

      <section>
        <p class="small">Trail</p>
        <div class="history" id="history"></div>
      </section>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const explainButton = document.querySelector("#explainButton");
      const toggleButton = document.querySelector("#toggleButton");
      const providerButton = document.querySelector("#providerButton");
      const keyButton = document.querySelector("#keyButton");
      const disconnectButton = document.querySelector("#disconnectButton");
      const clearButton = document.querySelector("#clearButton");
      const modeLabel = document.querySelector("#modeLabel");
      const statusDot = document.querySelector("#statusDot");
      const providerName = document.querySelector("#providerName");
      const connectionStatus = document.querySelector("#connectionStatus");
      const connectionHelp = document.querySelector("#connectionHelp");
      const activeLine = document.querySelector("#activeLine");
      const activeExplanation = document.querySelector("#activeExplanation");
      const activeMeta = document.querySelector("#activeMeta");
      const history = document.querySelector("#history");

      explainButton.addEventListener("click", () => vscode.postMessage({ type: "explainCurrent" }));
      toggleButton.addEventListener("click", () => vscode.postMessage({ type: "toggleAutoExplain" }));
      providerButton.addEventListener("click", () => vscode.postMessage({ type: "selectProvider" }));
      keyButton.addEventListener("click", () => vscode.postMessage({ type: "setApiKey" }));
      disconnectButton.addEventListener("click", () => vscode.postMessage({ type: "clearApiKey" }));
      clearButton.addEventListener("click", () => vscode.postMessage({ type: "clearHistory" }));

      window.addEventListener("message", (event) => {
        if (event.data.type !== "state") return;
        render(event.data);
      });

      function render(state) {
        const active = state.active || state.history[0];
        modeLabel.textContent = (state.autoExplain ? "Auto on" : "Auto paused") + " - " + state.provider;
        toggleButton.textContent = state.autoExplain ? "Pause" : "Resume";
        providerName.textContent = formatProvider(state.provider);
        providerButton.textContent = "Choose";
        keyButton.textContent = state.provider === "editor" ? "No key needed" : state.hasApiKey ? "Update key" : "Connect";
        keyButton.disabled = state.provider === "editor";
        disconnectButton.disabled = state.provider === "editor" || !state.hasApiKey;
        connectionStatus.textContent = state.provider === "editor" || state.hasApiKey ? "Connected" : "Not connected";
        connectionStatus.classList.toggle("connected", state.provider === "editor" || state.hasApiKey);
        connectionStatus.classList.toggle("missing", state.provider !== "editor" && !state.hasApiKey);
        connectionHelp.textContent = helpText(state.provider, state.hasApiKey);
        statusDot.classList.toggle("on", state.autoExplain);

        if (active) {
          activeLine.textContent = active.lineText || "(blank line)";
          activeExplanation.textContent = active.explanation || labelForStatus(active.status);
          activeExplanation.classList.toggle("error", active.status === "error");
          activeMeta.replaceChildren(
            pill(active.fileName),
            pill("line " + active.lineNumber),
            pill(active.languageId || "plain text")
          );
        }

        if (!state.history.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "Your cursor trail will appear here.";
          history.replaceChildren(empty);
          return;
        }

        history.replaceChildren(...state.history.map((crumb) => {
          const card = document.createElement("article");
          card.className = "card crumb";

          const head = document.createElement("div");
          head.className = "crumb-head";
          const title = document.createElement("h3");
          title.textContent = crumb.fileName;
          const line = document.createElement("span");
          line.className = "small";
          line.textContent = "L" + crumb.lineNumber;
          head.append(title, line);

          const text = document.createElement("p");
          text.className = "line";
          text.textContent = crumb.lineText || "(blank line)";

          const explanation = document.createElement("p");
          explanation.className = "explanation";
          explanation.classList.toggle("error", crumb.status === "error");
          explanation.textContent = crumb.explanation || labelForStatus(crumb.status);

          card.append(head, text, explanation);
          return card;
        }));
      }

      function pill(text) {
        const node = document.createElement("span");
        node.className = "pill";
        node.textContent = text;
        return node;
      }

      function labelForStatus(status) {
        if (status === "loading") return "Asking the language model...";
        if (status === "error") return "Could not generate an explanation.";
        return "Ready when you are.";
      }

      function formatProvider(provider) {
        if (provider === "openrouter") return "OpenRouter";
        if (provider === "groq") return "Groq";
        if (provider === "editor") return "Editor model";
        return "Gemini";
      }

      function helpText(provider, hasApiKey) {
        if (provider === "editor") return "Uses the language model account already connected to this editor.";
        if (hasApiKey) return "Your key is saved securely in VS Code SecretStorage.";
        return "Connect your " + formatProvider(provider) + " API key to start explaining code.";
      }
    </script>
  </body>
</html>`;
}
