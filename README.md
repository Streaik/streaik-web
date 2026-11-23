# Streak Web

## App name and language

The BYOK sample defaults to **Streak** and the Microsoft Entra sample defaults to **Contoso Chat**, a fictional company brand. Set `VITE_APP_NAME` in the sample's local environment file or build environment to override its name. See the [BYOK example](samples/byok/.env.example) and [Entra example](samples/entra/.env.example). Restart the dev server or rebuild after changing it. The browser tab, chat footer, and sidebar use the same name; blank overrides use the sample default.

On the first visit, the interface uses English, Dutch, or Spanish based on the browser's preferred languages, with English as the fallback. To change it, open **Account menu → Settings → Appearance → Language**. The choice takes effect immediately and is stored for that site in the browser. Chat messages, provider/model names and descriptions, and agent definitions are not translated.

UI translations are bundled with [i18next and react-i18next](packages/chat/src/i18n.ts). Add or edit translations in the [shared UI](packages/chat/src/locales/chat.ts), [sample UI](packages/chat/src/locales/samples.ts), or [agent UI](packages/chat/src/locales/agents.ts) dictionaries.

## Conversation history and assistant actions

The samples save conversations locally in IndexedDB by gateway and profile. The Entra sample isolates accounts; the BYOK sample hides its local conversation history while its key vault is locked. History is **not encrypted by the key vault**, synchronized across devices, or stored by the gateway. Use the expanded navigation to start, reopen, or delete a chat. Deleting a conversation only deletes its browser copy.

The stored shape is AI Happey's UI conversation envelope: an ID, an array of whole UI messages, and optional metadata. Usage, timing, and native part data emitted by the selected transport are retained. Keys and authentication headers are not part of the conversation store. Hosts that embed the chat component opt in by supplying a stable, non-secret profile ID. Changing routes does not fork or reset the local conversation.

Assistant replies show just the locally bundled provider logo when available, with the full model ID accessible as alt text. Otherwise the full model ID is shown. Usage, cost, and timing badges display only available values. Copy writes the reply text, including its Markdown, without reasoning or tool parts. Provider artwork is from the [LobeHub icon pack](https://github.com/lobehub/lobe-icons); brand marks belong to their respective owners.

The first browser client for Streaik. One React chat UI, two independently deployable samples. The existing AI Happey app is the visual reference, not a runtime dependency.

| Workspace | Responsibility |
| --- | --- |
| [`packages/chat`](packages/chat/src/ChatApp.tsx) | Shared welcome screen, model picker, transcript and composer. React owns local UI state; the Vercel AI SDK owns the chat stream and message state. |
| [`packages/gateway`](packages/gateway/src/index.ts) | Gateway and direct model discovery, chat transports, gateway Decisions calls, cancellation, and destination-scoped credentials. No auth SDK or UI dependency. |
| [`packages/themes`](packages/themes/src/index.tsx) | Independent HTML, shadcn/Radix, and Fluent UI adapters with theme-specific settings. |
| [`samples/byok`](samples/byok/src/ByokApp.tsx) | HeaderAuth gateway or browser-direct chat, provider-key settings, and opt-in encrypted storage. No Microsoft authentication dependency. |
| [`samples/entra`](samples/entra/src/EntraApp.tsx) | AzureAuth gateway, Microsoft Entra sign-in with MSAL Browser, and no provider-key UI or storage. |

## Chat attachments

Use **+ → Files** or drop files onto the composer. **+ → Link** accepts HTTP(S) URLs; choose a type if the URL doesn't have a recognizable file extension. Files and links can be sent without a typed message. Each turn can include up to 10 attachments and 10 MiB of local files in total.

**Settings → Attachments → Convert files to text** is off by default. Turning it on reads recognized text files (such as TXT, Markdown, CSV, and JSON) in the browser and sends their content instead of the original file. It does not extract PDF or Word text. Raw file support depends on the route and model. Supported image and PDF URLs are sent as native attachments where available; other links are sent as URL text. Streak does not download the linked content.

## Models and providers

In chat, open **Model** to see models for the active route grouped by provider. Search by model name, model ID, or provider. Use the arrow keys and Enter to choose a result, or Escape to close without changing the model.

Open **Models** or **Providers** from the icon rail. The expanded panel remains dedicated to chat history. Use **Back to chat** to return to the current conversation without resetting a draft or canceling a reply. **New chat** starts a separate conversation.

- **Models** shows discoveries from the active route's source: the gateway catalog or text chat models discovered directly from providers in BYOK. Search by name, ID, or tag, filter by provider, and browse capability tabs. In the gateway view, **Realtime** matches the gateway's realtime tag.
- **Providers** is a read-only directory, not a list of configured gateway integrations. It works without provider credentials or Entra sign-in and supports search, country of origin, and AI region filters. Available website, documentation, pricing, terms, privacy, and console links are shown as labeled icons.

The directory ships as a [generated snapshot](packages/chat/src/provider-directory.json). Normal web builds do not need the catalog checkout. To update it, check out the desired revision of [Streaik Catalog](../streaik-catalog/README.md) next to the web repo and run `node scripts/update-provider-directory.mjs` from the web repo. The [script](scripts/update-provider-directory.mjs) verifies the provider index and records against their manifest and records the source manifest digest in the snapshot. Use `--check` to compare the snapshot with that catalog revision.

## Browser agents

Open **Agents** from the navigation rail to browse, search, create, edit, or delete browser-local agents. Edit an existing sample agent to save a local override, or **Duplicate** it to create a separate agent. **Reset to sample default** removes the override and keeps assignments to that agent.

- **General** edits the name, description, instructions, argument hint, and ordered language and decision models.
- **Details** edits the owner, tags, and icon URLs. Agent cards prefer an icon for the active color scheme, then an icon for any theme, then the primary model's provider logo. If none can render, the card shows initials. External icon URLs are loaded by the browser.
- **Realtime** saves optional transcription and speech models and speech preferences. The pickers use the gateway catalog; saved model IDs remain visible when the catalog is unavailable. This tab does not start audio sessions or verify that saved options can run.

Edits keep the portable AI Happey JSON shape and preserve fields not exposed by the form, including structured outputs, tools, and provider-specific model settings.

Open **Settings → Agents** to select an agent for each role. Choosing the app's default agent by name follows future app defaults for that role; **None** explicitly disables it. Deleting a selected local agent leaves the assignment **Unavailable agent** until you change it.

- **Welcome message** generates the greeting in an empty chat. A skeleton shows while it loads, and the app falls back to **Welcome** if it can't generate one.
- **Conversation name** sends the first typed message and the app's requested language to the assigned model for a short title. The title is saved with the conversation; if no title is generated, the original message or attachment label remains.
- **Select a model** supplies the decision model and instructions when multiple reply models are selected. The other roles are configuration-only for now.

The welcome and title requests use the first compatible model in their assigned definition on the active route. These are separate text-only requests; they don't send tools, attachments, or the full agent definition, and they don't add to the transcript. Direct never falls back to the gateway. Agent chat and remote agent listing are not implemented.

Custom definitions, sample overrides, and assignments are stored in unencrypted browser local storage, scoped to the gateway and profile. Entra hides them when signed out; BYOK hides them while the key vault is locked, but the vault does **not** encrypt or erase them. Do not put credentials in definitions. Already-open tabs do not refresh automatically, data does not sync across devices, and clearing browser data removes it.

Hosts opt in through [`ChatApp`](packages/chat/src/ChatApp.tsx:126) and provide default definitions and role IDs through [`AgentsConfig`](packages/chat/src/agentCatalog.ts:7). Both samples use the same [sample configuration](samples/shared/appAgents.ts). Keep sample IDs and role IDs stable across deployments. Hosts that omit the history profile get session-only editing. The [catalog](packages/chat/src/agentCatalog.ts) keeps source and identity outside the [portable agent JSON](packages/chat/src/agentDefinition.ts); a future remote source can add its own catalog entries without changing the definition or the browser record format. Agent execution belongs in a separate transport, not in this editor or in the current model-chat request.

## Agent Skills

Open **Skills** in the navigation. The **Local** tab lets you create an [Agent Skills](https://agentskills.io/specification) bundle, edit its YAML metadata and Markdown instructions, add files by relative path, and choose a default local version. Editing saves a new version. Use **Import ZIP** to install a portable bundle, or download any local version as a ZIP. Skills are stored in the browser's conversation profile; without a profile they are session-only.

The **Providers** tab lists the gateway catalog. Open a skill to download its default or a pinned version, inspect its manifest, or save a local copy. **Upload to…** sends a copy of the selected version to a configured provider that accepts uploads. The gateway initially ships an OpenAI adapter. Provider-side editing, default-version changes, and deletion are not supported.

Imported or downloaded copies start disabled. Review a bundle before enabling it. Gateway chat sends only enabled skill names, descriptions, and exact IDs in the initial context. The two AI Happy-compatible skill tools load instructions and individual files on demand, and **API Chat** asks for approval before sharing each result. Direct routes do not send the skills catalog or tools. The app never runs bundled scripts, and a skill's `allowed-tools` field does not change Streaik's permissions.

ZIPs are limited to 16 MiB before and after expansion and up to 512 files. Large individual resource files remain downloadable but are not sent through the chat tool.

## Choose a chat route

Open **Account menu → Route** at the bottom of the sidebar. **API Chat** (`/api/chat`) is selected at startup. Entra shows the four gateway routes directly; BYOK puts them under **Gateway** and adds **Direct**. The native gateway options are Responses, Messages, and Chat Completions. A change applies to the next send; it does not interrupt or redirect an active reply or pending tool continuation.

**Direct does not need a running gateway.** Choose **Route → Direct** before entering a key if you want no gateway model request at all. Add or unlock the corresponding key in Settings, then pick a model. Direct uses the existing catalog snapshot for approved provider destinations and routes, and calls those providers' own model-list endpoints. No static model lists are needed for the current providers. The picker shows models compatible with the selected Direct route. Currently the catalog enables OpenAI (Chat Completions and Responses), Anthropic (Messages), and OpenRouter (Chat Completions). Only the matching provider key is sent, and redirects and automatic gateway fallback are disabled. An explicitly empty BYOK `VITE_GATEWAY_BASE` disables gateway requests; leaving it unset retains the `/gateway` default.

Both paths use the same chat hook and store the same UI message format. API Chat already streams UI messages; the native transports use the AI SDK to convert inline history and provider streams. Native routes support text chat and ordinary function tools; provider-specific features and metadata can differ between routes. Direct requires browser access to the catalog hosts; if deploying with a Content Security Policy, allow the supported provider origins in `connect-src`.

**Direct reply metrics** are saved in the same assistant message metadata as gateway metrics. Time to first token is measured from the browser's provider request to the first nonempty streamed output. Tokens per second divides reported output tokens by the first-to-last output interval; a single output chunk or missing token count has no throughput badge. Browser timings include network and parsing latency and can differ from gateway timings. OpenAI and Anthropic costs are USD estimates from the verified catalog rate cards in the snapshot, including separately priced cache reads and writes when reported. OpenRouter cost comes from the provider's streamed usage, including a valid zero. Missing prices or unsupported charges are not guessed.

## Let Decisions pick a chat model

In BYOK and Entra, open **Account menu → Route → Decisions**. Choose **`/v1/decisions`** (OpenAI-compatible and on by default), **`/api/decisions`** (Vercel AI SDK), or **Off**. This preference is saved locally for the current gateway and browser profile, independently of the chat route. Direct chat never calls Decisions.

In a gateway chat, use the **Model** dropdown to search for compatible models and check or uncheck them without closing the list. With two or more models checked, the web client asks the **Select a model** app agent's decision model to choose from those models. The decision model receives conversation text and candidate details, but not tool inputs, tool outputs, or attachments. Only the chosen chat model handles the reply and any tool continuations. Selecting one model skips the decision call; clearing all selections disables **Send**. **Stop** also cancels a pending decision.

The sample default uses `openai/gpt-6-luna`. In BYOK, configure a key for the decision model's provider as well as for the chat models you want to use. To choose another decision model or change its instructions, edit the agent or change the **Select a model** assignment under **Settings → Agents**. Set that assignment to **None**, or choose **Off** in the Route menu, to use a single model manually. If Decisions fails or returns a model you did not offer, the client reports the error without sending a chat request.

## Run without Azure (BYOK)

With Node.js 24+ and the gateway's .NET 11 SDK installed, run these commands from `Streaik/streaik-web` in separate terminals:

```text
dotnet run --project ../streaik-gateway/samples/Streaik.Gateway.Sample/Streaik.Gateway.Sample.csproj
```

```text
npm ci
npm run dev:byok
```

Open <http://localhost:5173>. Go to **Settings → API keys → Add API key**, choose a provider, and save its key. Then choose a model and send a message. Only configured providers appear in the key list, where you can replace or remove each key. Send a follow-up to check context, or click **Stop** during a longer reply. The dev server proxies `/gateway` to the HeaderAuth gateway on loopback port 5079. To use Direct, run only the web sample, select a Direct route, and add a supported provider key.

**Vault:** Keys are session-only unless you select **Set up encrypted storage** under **Settings → API keys** and enable the vault. The browser vault uses PBKDF2-SHA-256 (600,000 iterations) and AES-256-GCM with a fresh IV per write. Only the versioned encrypted record is persisted; the passphrase and unlocked keys are not. Reloading locks the vault. Use a strong passphrase; there is no recovery. Browser storage is origin-specific and the vault is bound to the configured gateway URL. Do not repoint a deployed gateway URL to an untrusted service. Encryption at rest does not protect unlocked keys against malicious same-origin scripts, browser extensions, or a compromised device.

## Run with Microsoft Entra

1. Register a **gateway API** in Entra. Expose a delegated API scope such as `access_as_user` and configure the API registration to issue v2 access tokens. Follow the [AzureAuth gateway setup](../streaik-gateway/README.md#choose-one-sample-host) for its tenant, audience, short scope name, and server-side provider keys.
2. Register a **SPA client** in the same tenant. Add `http://localhost:5174/auth-redirect.html` as a **Single-page application** redirect URI. Grant the SPA permission to call the gateway's delegated scope and consent as required by your tenant. Use the SPA's client ID in the web client and the gateway API's application identifier in its scope. The browser needs no client secret.
3. Copy [`samples/entra/.env.example`](samples/entra/.env.example) to `.env.local` in the same sample folder. Set `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID`, and `VITE_ENTRA_API_SCOPE` (the full URI, for example `api://<gateway-api-app-id>/access_as_user`). These are public build-time identifiers; never put provider keys or secrets in `VITE_*` settings.
4. From `Streaik/streaik-web`, run the gateway and the web sample separately:

```text
dotnet run --no-launch-profile --project ../streaik-gateway/samples/Streaik.Gateway.AzureAuth/Streaik.Gateway.AzureAuth.csproj -- --urls http://127.0.0.1:5080
```

```text
npm ci
npm run dev:entra
```

Open <http://localhost:5174>, allow the Microsoft sign-in pop-up, then choose a model and try a two-turn chat. The browser sends only a delegated gateway access token. The gateway handles provider credentials. If Microsoft requires reauthentication, use **Settings → Sign in again**.

## Build and deploy

`npm run build` type-checks and builds both samples into their respective `dist` directories. Deploy one sample per origin over HTTPS. By default, map `/gateway/*` on that origin to the matching gateway host, stripping `/gateway` and preserving the authorization or provider-key headers. Do not buffer SSE responses or redirect credential-bearing calls. The build-time `VITE_GATEWAY_BASE` can point to a separately hosted, explicitly trusted gateway with appropriate CORS; the AzureAuth sample does not enable cross-origin browser requests by default. `STREAIK_GATEWAY_TARGET` is for the dev proxy only. The Entra build includes an MSAL redirect bridge: serve it as a distinct page, register the exact deployed URI in Entra, and do not serve the bridge with a `Cross-Origin-Opener-Policy` header or rewrite it to the SPA.

## Optional MCP tools

Run one of the [standalone MCP apps](../streaik-mcp-servers/README.md) separately. The browser calls it directly using the official TypeScript MCP client **2.4.0**, pinned to **2026-07-28**. No MCP requests go through the chat gateway. With `VITE_MCP_BASE` unset, chat behaves as before.

- **BYOK:** Set `VITE_MCP_BASE=http://localhost:5087` in the BYOK sample. Add the OpenAI, Google, or Anthropic key in Settings. Only the matching provider key goes to each MCP route.
- **Entra:** Set `VITE_MCP_BASE=http://localhost:5088` and `VITE_ENTRA_MCP_SCOPE=api://<mcp-api-app-id>/access_as_user` in the Entra sample. Grant the SPA permission to that MCP API scope in addition to its chat scope. Sign in again if consent is missing. The MCP app receives its own Entra access token, not the chat token or provider keys.
- Configure the browser's origin on the MCP app. In the chat, click **Discover MCP tools**. On **API Chat**, the browser runs requested client tools (including local plugins) and opens a result-review modal. **Approve and share** sends the result to the model; **Decline** continues without sharing the output. Declining does not undo execution, so enable only MCP servers you trust to receive tool arguments and run calls. MCP image previews stay in the browser. On native routes, the existing approval before an MCP call still applies.
- API Chat client-tool reviews work without signing. To enable signature validation, set **Gateway:ApprovalSigningKey** in the server configuration (environment variable **Gateway__ApprovalSigningKey**), or register a **ToolApprovalSigner** in a custom host. Do not put the signing key in the web app. Provider-executed tools never open the API Chat review modal.

Run `npm run test:mcp` after installing Chromium to test the standalone MCP transport and browser flow without a chat gateway process or cloud credentials.

## Verification and scope

```text
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

Tests use fixture responses and simulated MSAL credentials; they do not require a live Entra tenant or paid provider requests. The browser tests use ports 15173 and 15174 so they can run alongside the sample dev servers. Run the manual setup above to verify live provider and tenant configuration.

The browser regressions block all gateway traffic for a BYOK Direct conversation and simulate native provider replies. They do not validate live provider CORS or Entra tenant configuration. Model categories are for discovery, not proof that every protocol or tool is supported for a model. The web composer does not dispatch media requests.

## Appearance and theme adapters

Open **Settings → Appearance** to select a theme, switch between System, Light and Dark, or edit settings for the active theme. Settings apply immediately and are saved per browser origin. Reset affects only that theme, not the selected theme or color mode.

| Theme | Controls | Icons | Theme-specific settings |
| --- | --- | --- | --- |
| [HTML](packages/themes/src/html.tsx) | Native browser controls and system colors | Lucide React | Chat text size |
| [shadcn](packages/themes/src/shadcn.tsx) (default) | Streaik-owned shadcn components with upstream Radix Select for keyboard navigation | Lucide React | Palette and corner radius |
| [Fluent](packages/themes/src/fluent.tsx) | Upstream Fluent UI controls and theme tokens | Fluent React Icons (Regular) | Fluent Web or Microsoft Teams preset |

To add a theme, implement the [`ThemeAdapter`](packages/themes/src/contract.ts:23) contract and register a lazy loader in the [theme registry](packages/themes/src/index.tsx:7). The adapter supplies its controls, validated preferences and settings form. It can set the shared surface variables on the theme root and scope its own component styles. Keep theme-specific library imports inside the adapter so choosing a theme doesn't load unrelated libraries. The chat and auth state remain outside the adapter's controls; keep the theme host and settings dialog mounted when changing themes.

For other dropdowns, the shared [`Select()`](packages/themes/src/index.tsx:115) accepts optional groups on its options. Search is a separate opt-in and uses the same themed picker across adapters.

Each adapter supplies an [`IconSet`](packages/themes/src/contract.ts:22): a component for every semantic icon name. Import only the glyphs used by the adapter and forward sizing, styling and accessibility props to them. Shared UI uses the themed [`Icon`](packages/themes/src/index.tsx:107) rather than importing a library directly. The icons are decorative; give icon-only controls their own accessible names. HTML uses the same [Lucide mapping](packages/themes/src/lucideIcons.ts) as shadcn, including while a different adapter is still loading.
