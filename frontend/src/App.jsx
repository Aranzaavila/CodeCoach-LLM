import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const HISTORY_KEY = 'codecoach.history.v1'
const SETTINGS_KEY = 'codecoach.settings.v1'

const modes = [
  {
    id: 'mentor',
    label: 'Mentor',
    tabLabel: 'MENTOR',
    promptLabel: 'mentor',
    color: '#f0a500',
    placeholder: 'ask a question...',
    banner: '// mentor mode active — I guide with questions, not answers',
  },
  {
    id: 'debug',
    label: 'Debug',
    tabLabel: 'DEBUG',
    promptLabel: 'debug',
    color: '#4a9eff',
    placeholder: "paste your error or describe what's broken...",
    banner: "// debug mode active — We'll trace what failed and why",
  },
  {
    id: 'ai-coach',
    label: 'AI Coach',
    tabLabel: 'AI COACH',
    promptLabel: 'ai coach',
    color: '#00c896',
    placeholder: 'paste a prompt you wrote...',
    banner: '// ai coach mode active — I help sharpen prompts and reasoning',
  },
]

const defaultSettings = {
  fontSize: 'medium',
}

const getMode = (modeValue) =>
  modes.find((mode) => mode.id === modeValue || mode.label === modeValue) ?? modes[0]

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const formatTimestamp = (date = new Date()) =>
  date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const readStorage = (key, fallback) => {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const storedValue = window.localStorage.getItem(key)
    return storedValue ? JSON.parse(storedValue) : fallback
  } catch (error) {
    console.error(`Unable to read ${key} from localStorage`, error)
    return fallback
  }
}

const writeStorage = (key, value) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(`Unable to write ${key} to localStorage`, error)
  }
}

const normalizeHistory = (value) => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry) => entry && Array.isArray(entry.messages))
    .map((entry) => {
      const entryMode = getMode(entry.mode)
      const messages = entry.messages
        .filter((message) => message && typeof message.text === 'string')
        .map((message) => ({
          id: message.id ?? createId(),
          role: message.role === 'assistant' ? 'assistant' : 'user',
          text: message.text,
          mode: getMode(message.mode ?? entryMode.label).label,
          timestamp: message.timestamp ?? entry.timestamp ?? formatTimestamp(),
        }))

      return {
        id: entry.id ?? createId(),
        mode: entryMode.label,
        firstMessage: entry.firstMessage ?? messages.find((message) => message.role === 'user')?.text ?? '',
        messages,
        timestamp: entry.timestamp ?? formatTimestamp(),
      }
    })
}

const readHistory = () => normalizeHistory(readStorage(HISTORY_KEY, []))

const readSettings = () => {
  const storedSettings = readStorage(SETTINGS_KEY, defaultSettings)

  return {
    ...defaultSettings,
    ...storedSettings,
    fontSize: ['small', 'medium', 'large'].includes(storedSettings?.fontSize)
      ? storedSettings.fontSize
      : defaultSettings.fontSize,
  }
}

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [activeModeId, setActiveModeId] = useState(modes[0].id)
  const [isLoading, setIsLoading] = useState(false)
  const [history, setHistory] = useState(readHistory)
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(readSettings)
  const endOfMessagesRef = useRef(null)
  const activeRequestRef = useRef(null)

  const activeMode = getMode(activeModeId)
  const appStyle = useMemo(
    () => ({
      '--mode-color': activeMode.color,
    }),
    [activeMode.color],
  )

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    writeStorage(HISTORY_KEY, history)
  }, [history])

  useEffect(() => {
    writeStorage(SETTINGS_KEY, settings)
  }, [settings])

  const upsertConversation = (conversationId, conversationMode, nextMessages) => {
    const userFirstMessage = nextMessages.find((message) => message.role === 'user')?.text ?? 'New chat'
    const timestamp = formatTimestamp()

    setHistory((currentHistory) => {
      const existingEntry = currentHistory.find((entry) => entry.id === conversationId)
      const nextEntry = {
        id: conversationId,
        mode: conversationMode.label,
        firstMessage: existingEntry?.firstMessage ?? userFirstMessage,
        messages: nextMessages,
        timestamp,
      }

      return [nextEntry, ...currentHistory.filter((entry) => entry.id !== conversationId)]
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedInput = input.trim()
    if (!trimmedInput || isLoading) {
      return
    }

    const messageMode = activeMode
    const conversationId = currentConversationId ?? createId()
    activeRequestRef.current = conversationId
    const userMessage = {
      id: createId(),
      role: 'user',
      text: trimmedInput,
      mode: messageMode.label,
      timestamp: formatTimestamp(),
    }
    const nextMessages = [...messages, userMessage]

    setCurrentConversationId(conversationId)
    setMessages(nextMessages)
    upsertConversation(conversationId, messageMode, nextMessages)
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedInput,
          mode: messageMode.label,
        }),
      })

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const data = await response.json()

      if (typeof data.response !== 'string' || data.response.trim() === '') {
        throw new Error('Missing response text')
      }

      const assistantMessage = {
        id: createId(),
        role: 'assistant',
        text: data.response,
        mode: messageMode.label,
        timestamp: formatTimestamp(),
      }
      const resolvedMessages = [...nextMessages, assistantMessage]

      if (activeRequestRef.current === conversationId) {
        setMessages(resolvedMessages)
      }
      upsertConversation(conversationId, messageMode, resolvedMessages)
    } catch (error) {
      const fallbackMessage = {
        id: createId(),
        role: 'assistant',
        text: 'I ran into a problem reaching the server. Please make sure the backend is running and try again.',
        mode: messageMode.label,
        timestamp: formatTimestamp(),
      }
      const failedMessages = [...nextMessages, fallbackMessage]

      if (activeRequestRef.current === conversationId) {
        setMessages(failedMessages)
      }
      upsertConversation(conversationId, messageMode, failedMessages)
      console.error(error)
    } finally {
      if (activeRequestRef.current === conversationId) {
        activeRequestRef.current = null
        setIsLoading(false)
      }
    }
  }

  const handleNewChat = () => {
    activeRequestRef.current = null
    setMessages([])
    setInput('')
    setCurrentConversationId(null)
    setIsLoading(false)
  }

  const handleLoadConversation = (entry) => {
    activeRequestRef.current = null
    setMessages(entry.messages)
    setCurrentConversationId(entry.id)
    setActiveModeId(getMode(entry.mode).id)
    setInput('')
    setIsLoading(false)
  }

  const handleClearHistory = () => {
    activeRequestRef.current = null
    setHistory([])
    setMessages([])
    setInput('')
    setCurrentConversationId(null)
  }

  const handleFontSizeChange = (fontSize) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      fontSize,
    }))
  }

  return (
    <main className={`app-shell font-${settings.fontSize}`} style={appStyle}>
      <nav className="top-nav" aria-label="CodeCoach">
        <div className="brand" aria-label="CodeCoach">
          <span className="brand-diamond" aria-hidden="true">
            ◆
          </span>
          <span className="brand-name">CODECOACH</span>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="Chat mode">
          {modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={mode.id === activeModeId}
              className={`mode-tab ${mode.id === activeModeId ? 'is-active' : ''}`}
              style={{ '--tab-color': mode.color }}
              onClick={() => setActiveModeId(mode.id)}
            >
              <span aria-hidden="true">◆</span>
              {mode.tabLabel}
            </button>
          ))}
        </div>

        <div className="nav-actions">
          <button className="new-chat-button" type="button" onClick={handleNewChat}>
            + New Chat
          </button>
          <button
            className="settings-button"
            type="button"
            aria-label="Open settings"
            onClick={() => setIsSettingsOpen(true)}
          >
            ⚙
          </button>
        </div>
      </nav>

      <section className="chat-area" aria-live="polite">
        <div className="mode-comment">{activeMode.banner}</div>

        {messages.map((message) => {
          const messageMode = getMode(message.mode)
          const modeStyle = { '--message-color': messageMode.color }

          return (
            <article
              key={message.id}
              className={`message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
              style={modeStyle}
            >
              {message.role === 'assistant' ? (
                <>
                  <div className="assistant-icon" aria-hidden="true">
                    ◆
                  </div>
                  <div className="message-stack">
                    <div className="message-label">CODECOACH · {messageMode.tabLabel}</div>
                    <div className="assistant-card">
                      <p>{message.text}</p>
                    </div>
                    <time className="message-time">{message.timestamp}</time>
                  </div>
                </>
              ) : (
                <>
                  <div className="message-stack">
                    <div className="user-label">YOU</div>
                    <div className="user-card">
                      <p>{message.text}</p>
                    </div>
                    <time className="message-time">{message.timestamp}</time>
                  </div>
                  <div className="user-badge" aria-hidden="true">
                    YOU
                  </div>
                </>
              )}
            </article>
          )
        })}

        {isLoading ? (
          <article className="message-row is-assistant" style={{ '--message-color': activeMode.color }}>
            <div className="assistant-icon" aria-hidden="true">
              ◆
            </div>
            <div className="message-stack">
              <div className="message-label">CODECOACH · {activeMode.tabLabel}</div>
              <div className="assistant-card typing-card" aria-label="CodeCoach is typing">
                <span className="typing-dot" aria-hidden="true"></span>
                <span className="typing-dot" aria-hidden="true"></span>
                <span className="typing-dot" aria-hidden="true"></span>
              </div>
            </div>
          </article>
        ) : null}

        <div ref={endOfMessagesRef} />
      </section>

      <form className="terminal-input" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="chat-input">
          Message CodeCoach
        </label>
        <span className="prompt-prefix" aria-hidden="true">
          ◆ {activeMode.promptLabel} &gt;
        </span>
        <input
          id="chat-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={activeMode.placeholder}
          disabled={isLoading}
          autoComplete="off"
        />
        <button className="send-button" type="submit" disabled={isLoading || input.trim() === ''}>
          ↑ send
        </button>
      </form>

      <footer className={`history-bar ${isHistoryOpen ? 'is-open' : ''}`}>
        <div className="history-strip">
          <button className="history-toggle" type="button" onClick={() => setIsHistoryOpen(!isHistoryOpen)}>
            HISTORY {isHistoryOpen ? '▲' : '▼'}
          </button>
          <div className="history-chips" aria-label="Recent conversations">
            {history.length > 0 ? (
              history.map((entry) => {
                const entryMode = getMode(entry.mode)

                return (
                  <button
                    key={entry.id}
                    className="history-chip"
                    type="button"
                    style={{ '--chip-color': entryMode.color }}
                    onClick={() => handleLoadConversation(entry)}
                    title={entry.firstMessage}
                  >
                    <span className="history-mark" aria-hidden="true">
                      ◆
                    </span>
                    <span className="history-chip-text">{entry.firstMessage}</span>
                  </button>
                )
              })
            ) : (
              <span className="empty-history">no saved chats</span>
            )}
          </div>
        </div>

        {isHistoryOpen ? (
          <div className="history-panel" aria-label="Conversation history">
            {history.length > 0 ? (
              history.map((entry) => {
                const entryMode = getMode(entry.mode)

                return (
                  <button
                    key={entry.id}
                    className="history-row"
                    type="button"
                    style={{ '--row-color': entryMode.color }}
                    onClick={() => handleLoadConversation(entry)}
                  >
                    <span className="history-row-title">
                      <span className="history-mark" aria-hidden="true">
                        ◆
                      </span>
                      <span className="history-row-text">{entry.firstMessage}</span>
                    </span>
                    <span className="history-row-mode">{entryMode.tabLabel}</span>
                    <time className="history-row-time">{entry.timestamp}</time>
                  </button>
                )
              })
            ) : (
              <div className="history-empty-panel">// no history yet</div>
            )}
          </div>
        ) : null}
      </footer>

      {isSettingsOpen ? (
        <div className="settings-overlay" role="presentation" onMouseDown={() => setIsSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="settings-header">
              <h2 id="settings-title">// SETTINGS</h2>
              <button
                className="settings-close"
                type="button"
                aria-label="Close settings"
                onClick={() => setIsSettingsOpen(false)}
              >
                X
              </button>
            </header>

            <div className="settings-section">
              <div className="settings-label">Font size</div>
              <div className="font-toggle" role="group" aria-label="Font size">
                {['small', 'medium', 'large'].map((fontSize) => (
                  <button
                    key={fontSize}
                    type="button"
                    className={settings.fontSize === fontSize ? 'is-active' : ''}
                    onClick={() => handleFontSizeChange(fontSize)}
                  >
                    {fontSize}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <button className="clear-history-button" type="button" onClick={handleClearHistory}>
                Clear history
              </button>
            </div>

            <p className="about-text">CodeCoach v1.0 — mentor-style AI programming coach</p>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default App
