# streaik-web

A browser-based AI chat client with streaming, provider switching, Agents, [MCP](https://modelcontextprotocol.io/), [Skills](https://agentskills.io), [Plugins](https://agent-plugins.org), files and rich response rendering.

Connect compatible AI APIs, agent runtimes and MCP servers directly from the client.

[![streaik-web](./assets/screenshot_web.png)](https://chat.streaik.com)

The chat client supports:

- **Streaming chat** with rich message rendering, charts and interactive UI
- **Provider and model switching** across gateway and direct APIs
- **Multi-protocol routing** with API Chat, Responses, Messages and Chat Completions
- **Model discovery** with catalogs, favorites and filters
- **Provider settings** with native options and metadata passthrough
- **Agents and workflows** with multi-agent orchestration and execution activity
- **Decisions** with intelligent model and agent routing
- **Realtime voice** with bidirectional audio and streaming playback
- **Agent Plugins** combining Skills, MCP servers and supporting resources
- **MCP** tools, resources, prompts, elicitation, completions and tasks
- **Tool execution** with parallel calls, approvals and execution activity
- **Server-side tools** with native web search, code execution and MCP
- **Skills** with reusable instructions and supporting files
- **Search** with client-side full-text, vector and hybrid search
- **Files** with attachments, document extraction and rich previews
- **Conversation history** with local persistence and full-text search
- **Speech** with streaming synthesis, downloadable audio and Read aloud
- **Transcriptions** with realtime transcription, dictation and file processing
- **Images** with generation and provider-specific options
- **Videos** with asynchronous generation, job tracking and inline playback
- **Benchmarks** with repeatable multi-model comparisons
- **Usage analytics** with token consumption and cost tracking
- **Performance metrics** with TTFT and TPS
- **Authentication** with BYOK and Microsoft Entra
- **Multi-theme UI** with Shadcn, Fluent and HTML implementations
- **Localization** with multilingual support
- **Model capabilities** across language, audio, images, video, embeddings and reranking

Documentation: https://ai.streaik.net/scalar  
App: https://chat.streaik.com

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

