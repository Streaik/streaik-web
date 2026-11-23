# streaik-chat

A browser-based AI chat client with streaming, provider switching, Agents, [MCP](https://modelcontextprotocol.io/), [Skills](https://agentskills.io), [Plugins](https://agent-plugins.org), files and rich response rendering.

Connect compatible AI APIs, agent runtimes and MCP servers directly from the client.

[![streaik-web](https://achappey.github.io/aihappey-chat/images/screenshot_chat.png)](https://chat.streaik.com)

The chat client supports:

- **Streaming chat** with rich incremental message rendering
- **Provider and model switching** across Gateway and direct provider APIs
- **Multi-protocol routing** through API Chat, Responses, Messages, Chat Completions and Direct APIs
- **Model discovery** with cached catalogs, background refresh, favorites, filters and configurable default preferences
- **Provider settings** with model-specific options and native metadata passthrough
- **Agents and workflows** through connected agent runtimes with multi-agent orchestration
- **Realtime agents** with bidirectional audio, interruptions, streaming playback and tool execution
- **Decisions** with intelligent multi-model and agent routing based on user input and configurable decision models
- **Agent Plugins** combining Skills, MCP servers and supporting resources
- **MCP** tools, resources, prompts, elicitation and tasks
- **Tool execution** with parallel tool calls, human-in-the-loop approvals and execution activity
- **Server-side tools** with provider-native web search, code execution, MCP and other supported capabilities
- **Skills** with reusable instructions and supporting files
- **Search** with client-side full-text, vector and hybrid search
- **Files** with attachments, document content, PDF extraction and rich file handling
- **Conversation history** with local persistence, search and configurable chat preferences
- **Streaming UI** with interactive apps, cards and structured response rendering
- **Speech** with generation, streaming playback and realtime transcription
- **Transcriptions** with configurable file splitting, overlap handling and merged results
- **Images and video** with generation, provider-specific options and asynchronous jobs
- **Benchmarks** with multi-model comparisons, configurable routing and repeatable test runs
- **Usage analytics** with interactive charts, token consumption and cost tracking
- **Performance metrics** including time to first token (TTFT) and tokens per second (TPS)
- **Authentication** with header-based/BYOK and Microsoft Entra support
- **Multi-theme UI** with interchangeable Shadcn, Fluent, Bootstrap, Mantine, Material and Chakra implementations
- **Localization** with support for 15+ languages
- **Model capabilities** including speech, transcription, embeddings, reranking, images, video, decision and other supported modalities

Documentation: https://ai.streaik.net/scalar  
App: https://chat.streaik.com

## Transcriptions

Open **Transcriptions**, choose a model, attach or drop audio files, and select **Send**. Choose **Account → Route** for normalized JSON, native multipart, or streaming output from an uploaded file. For larger recordings, enable file splitting and set the overlap in **Transcription settings**. File support depends on the selected provider and route.

The microphone button next to **Send** opens **Streaming**. OpenAI uses WebRTC with a short-lived client secret; Gladia uses the gateway-issued WebSocket session URL. Select the microphone model in **Transcription settings**. Microphone access requires HTTPS or localhost. The browser connects directly to the selected provider for live audio; deployments must allow those provider connections.

Completed transcripts appear under **Finished** and are stored locally when a history profile is available. Uploaded audio is retained locally for playback. Microphone audio is not recorded to the local library, and session credentials are not stored.

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

