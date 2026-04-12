import { useEffect, useRef, useState } from 'react'
import './App.css'

const initialMessages = [
  {
    id: 1,
    role: 'assistant',
    text: "Hi, I'm CodeCoach. Ask me anything about your code or project.",
  },
]

function App() {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const endOfMessagesRef = useRef(null)
  const nextMessageId = useRef(initialMessages.length + 1)

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const appendMessage = (role, text) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: nextMessageId.current++,
        role,
        text,
      },
    ])
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedInput = input.trim()
    if (!trimmedInput || isLoading) {
      return
    }

    appendMessage('user', trimmedInput)
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmedInput }),
      })

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const data = await response.json()

      if (typeof data.response !== 'string' || data.response.trim() === '') {
        throw new Error('Missing response text')
      }

      appendMessage('assistant', data.response)
    } catch (error) {
      appendMessage(
        'assistant',
        'I ran into a problem reaching the server. Please make sure the backend is running and try again.',
      )
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="chat-card">
        <header className="chat-header">
          <div>
            <p className="chat-eyebrow">AI coding partner</p>
            <h1>CodeCoach 🎓</h1>
          </div>
        </header>

        <section className="chat-messages" aria-live="polite">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
            >
              <div className="message-meta">
                {message.role === 'user' ? 'You' : 'CodeCoach'}
              </div>
              <div className={`message-bubble ${message.role}`}>
                <p>{message.text}</p>
              </div>
            </article>
          ))}

          {isLoading ? (
            <article className="message-row is-assistant">
              <div className="message-meta">CodeCoach</div>
              <div className="message-bubble assistant loading-bubble">
                <span className="loading-dot" aria-hidden="true"></span>
                <span className="loading-dot" aria-hidden="true"></span>
                <span className="loading-dot" aria-hidden="true"></span>
                <p>CodeCoach is thinking...</p>
              </div>
            </article>
          ) : null}

          <div ref={endOfMessagesRef} />
        </section>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chat-input">
            Ask CodeCoach a question
          </label>
          <input
            id="chat-input"
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask CodeCoach about your code..."
            disabled={isLoading}
            autoComplete="off"
          />
          <button type="submit" disabled={isLoading || input.trim() === ''}>
            Send
          </button>
        </form>
      </div>
    </main>
  )
}

export default App
