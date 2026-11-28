# streaik-web

A browser-based AI chat client with streaming, provider switching, Agents, [MCP](https://modelcontextprotocol.io/), [Skills](https://agentskills.io), [Plugins](https://agent-plugins.org), files and rich response rendering.

Connect compatible AI APIs, agent runtimes and MCP servers directly from the client.

[![streaik-web](./assets/screenshot_web.png)](https://chat.streaik.com)

The chat client supports:

- **Streaming chat** with rich incremental message rendering, charts and more
- **Provider and model switching** across Gateway and direct provider APIs
- **Multi-protocol routing** through API Chat, Responses, Messages, Chat Completions and Direct APIs
- **Model discovery** with catalogs, favorites, filters and configurable default preferences
- **Provider settings** with model-specific options and native metadata passthrough
- **Agents and workflows** on direct APIs or through connected agent runtimes with multi-agent orchestration
- **OpenAI Responses multi-agent activity** on direct and gateway Responses, and API Chat when backed by native OpenAI Responses. The existing activity pager shows provider-executed actions and agent-attributed searches; only root text appears in the main transcript. Ordered native history travels in provider metadata for inline replay on compatible follow-ups with provider storage disabled. Encrypted payloads remain opaque; other routes use the ordinary transcript.
- **Native realtime voice chat** with bidirectional audio, provider-specific controls and streaming playback
- **Decisions** with intelligent multi-model and agent routing based on user input and configurable decision models
- **Agent Plugins** combining Skills, MCP servers and supporting resources
- **MCP** tools, resources, prompts, elicitation and tasks. Prompt and resource template arguments stay free-form and offer suggestions when the server advertises completions.
- **Tool execution** with parallel tool calls, pre-execution approvals and execution activity. Approval shows the requested tool and inputs; declining does not run the tool.
- **Server-side tools** with provider-native web search, code execution, MCP and other supported capabilities
- **Skills** with reusable instructions and supporting files
- **Search** with client-side full-text, vector and hybrid search
- **Files** with attachments, document content, PDF extraction and rich file handling
- **Conversation history** with local persistence, configurable chat preferences, and browser-only full-text search across titles and user and assistant messages
- **Streaming UI** with interactive apps, cards and structured response rendering
- **Speech** with text-to-speech generation, streaming playback, downloadable clips and assistant-message Read aloud
- **Transcriptions** with configurable file splitting, overlap handling and merged results. **Real-time** streams microphone audio to supported OpenAI, Gladia, Google Gemini Transcribe Live, Deepgram Nova-2/Nova-3, and AssemblyAI streaming models and displays text only. A compatible live model assigned to the Transcription agent can also stream composer dictation. **Dictate** on the Transcriptions page records a short clip and uploads it when you stop.
- **Images** with generation and provider-specific options
- **Videos** with prompt-only generation and inline playback. Pending jobs and results are saved locally for the current gateway/profile. Reopen Videos with the same credentials to resume polling; gateway job references and provider-hosted video links can expire.
- **Benchmarks** with multi-model comparisons, configurable routing and repeatable test runs
- **Usage analytics** with interactive charts, token consumption and cost tracking
- **Performance metrics** including time to first token (TTFT) and tokens per second (TPS)
- **Authentication** with header-based/BYOK and Microsoft Entra support
- **Multi-theme UI** with interchangeable Shadcn, Fluent and HTML implementations
- **Localization** with support for 2+ languages
- **Model capabilities** including speech, transcription, embeddings, reranking, images, video, decision and other supported modalities

Documentation: https://ai.streaik.net/scalar  
App: https://chat.streaik.com

## Realtime speech

In Speech, **Route → Direct → WebSocket** connects the browser to the speech provider with a short-lived credential from the Gateway. It is the default for supported realtime speech models: Mistral Voxtral Mini TTS 3.0, Deepgram Aura-2 Asteria, and Cartesia Sonic 3.6 voices. The assistant’s **Read aloud** action uses the model assigned to the Speech agent and the same route preference. An explicit route choice is saved for the current profile and takes precedence over the model default. Direct WebSocket produces WAV clips; if a model, setting or connection is unsupported, the app reports an error without retrying on a Gateway speech route.

## Local mode

Use [local.streaik.com](https://local.streaik.com) with the standalone Windows runtimes:

- [streaik-gateway](https://github.com/Streaik/streaik-gateway/releases/latest)
- [streaik-agents](https://github.com/Streaik/streaik-agents)

The browser app connects to AI and Agents running on your own PC.

## Windows desktop

A standalone, Windows 11 native application built with WinUI 3. The AI gateway and Agents runtime runs on your own machine.

- Streaming chat with model and agent switching
- MCP tools and resources, Skills and local conversation history
- Native Windows UI with light, dark and high-contrast themes
- Local and remote runtime switching

**Repository:** [streaik-windows](https://github.com/Streaik/streaik-windows)

