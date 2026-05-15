# Changelog

## 0.0.6

- Moved Breadcrumbs out of the left Activity Bar and into the Panel.
- Added a top-right editor title action for opening Breadcrumbs.

## 0.0.5

- Added a provider setup card to the sidebar.
- Shows provider connection status directly in the Breadcrumbs view.
- Added connect/update key and disconnect key actions to the sidebar.

## 0.0.4

- Added a Node unit test suite for core explanation and history behavior.
- Added a VS Code extension-host smoke test.
- Added provider timeout and one retry for transient provider failures.
- Recovered gracefully from malformed workspace history state.
- Added marketplace metadata, keywords, repository metadata, and this changelog.

## 0.0.3

- Fixed stale loading crumbs when async explanations finish after the cursor moves.
- Fixed VS Code Language Model stream cancellation timing.
- Replaced predictable CSP nonces with crypto-generated nonces.
- Added a one-time privacy notice before sending code context to an AI provider.
- Reduced unnecessary work from same-line cursor movement.

## 0.0.2

- Added Gemini, OpenRouter, Groq, and editor provider support.
- Added secure provider API key storage through VS Code SecretStorage.
- Added provider selection and key management commands.

## 0.0.1

- Initial Breadcrumbs VS Code/Cursor extension prototype.
- Added sidebar webview, cursor tracking, debounced explanations, and local trail history.
