# Breadcrumbs

Breadcrumbs is a VS Code and Cursor extension that follows the active editor cursor, records a trail of visited lines, and explains the current line in a sidebar.

## What It Does

- Adds a `Breadcrumbs` panel view instead of taking over left activity-bar space.
- Adds a top-right editor action for opening Breadcrumbs while reading code.
- Tracks cursor movement across files.
- Debounces automatic explanations so the model is not called on every tiny movement.
- Includes surrounding lines in the prompt for better context.
- Stores recent line visits in workspace state.
- Uses VS Code theme variables so it feels native in VS Code and Cursor.
- Supports Gemini, OpenRouter, Groq, and the VS Code Language Model API.
- Stores provider API keys in VS Code SecretStorage.
- Shows a provider setup card in the sidebar so users can connect, update, or disconnect their AI provider key.

## Commands

- `Breadcrumbs: Explain Current Line`
- `Breadcrumbs: Toggle Auto Explain`
- `Breadcrumbs: Clear Trail`
- `Breadcrumbs: Select AI Provider`
- `Breadcrumbs: Set Provider API Key`
- `Breadcrumbs: Clear Provider API Key`

## Settings

- `breadcrumbs.autoExplain`: Explain after cursor movement settles.
- `breadcrumbs.provider`: `gemini`, `openrouter`, `groq`, or `editor`.
- `breadcrumbs.geminiModel`: Gemini model for direct API explanations.
- `breadcrumbs.openRouterModel`: OpenRouter model ID. Free variants usually end with `:free`.
- `breadcrumbs.groqModel`: Groq model ID.
- `breadcrumbs.maxOutputTokens`: Maximum response size for direct API providers.
- `breadcrumbs.providerTimeoutMs`: Timeout for direct provider API requests.
- `breadcrumbs.debounceMs`: Delay before explaining a cursor move.
- `breadcrumbs.contextRadius`: Number of surrounding lines sent with the prompt.
- `breadcrumbs.maxHistory`: Maximum trail entries retained per workspace.

## Free Provider Setup

Recommended default:

1. Set `breadcrumbs.provider` to `gemini`.
2. Open the Breadcrumbs sidebar.
3. Use the provider setup card to connect your Gemini API key from Google AI Studio.

OpenRouter and Groq work the same way:

1. Run `Breadcrumbs: Select AI Provider`.
2. Pick `openrouter` or `groq`.
3. Use the sidebar setup card or `Breadcrumbs: Set Provider API Key`.

The extension does not store keys in `settings.json`. Keys are stored through VS Code SecretStorage.

## Privacy Notice

Breadcrumbs sends the current line and surrounding code context to your selected AI provider when it generates an explanation. The extension shows a one-time confirmation before the first explanation request. Avoid enabling auto explain in workspaces that contain secrets, credentials, or private customer data unless your provider choice is approved for that code.

## Development

Install dependencies:

```bash
npm install
```

Compile:

```bash
npm run compile
```

Run the extension:

1. Open this folder in VS Code or Cursor.
2. Press `F5`.
3. In the Extension Development Host, use the Breadcrumbs editor-title button or run `Breadcrumbs: Open`.
4. Move your cursor through a code file.

Package a `.vsix`:

```bash
npm run package
```

## AI Notes

Breadcrumbs defaults to Gemini because it is the cleanest direct free-tier API option for most developers. OpenRouter is useful for `:free` model variants, and Groq is useful for fast lightweight explanations. The `editor` provider uses the host editor's VS Code Language Model API when available.

Direct provider calls use a request timeout and one retry for transient failures such as rate limits or server errors.

## Testing

Run unit tests:

```bash
npm test
```

Run the VS Code extension-host smoke test:

```bash
npm run test:smoke
```

On locked-down Windows environments, the smoke test may need permission to run the downloaded VS Code executable from `.vscode-test`.
