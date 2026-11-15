import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Bot, LoaderCircle, Sparkles } from 'lucide-react';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const STARTER_PROMPTS = [
  'Summarize my archive',
  'What is on my watchlist?',
  'Find notes about design',
];

export const AIChatView: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isLoading]);

  const sendMessage = async (value = draft) => {
    const content = value.trim();
    if (!content || isLoading) return;
    const priorMessages = messages;
    const nextMessages: ChatMessage[] = [...priorMessages, { role: 'user', content }];
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, history: priorMessages.slice(-8) }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok || typeof result.reply !== 'string') {
        throw new Error(result.error || 'The assistant could not respond. Please try again.');
      }
      setMessages((current) => [...current, { role: 'assistant', content: result.reply }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The assistant could not respond.');
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  return (
    <section className="mx-auto flex h-full min-h-[calc(100dvh-9rem)] max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#09090b] text-zinc-100 shadow-2xl">
      <header className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3.5 sm:px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
          <Sparkles className="h-4 w-4 text-zinc-100" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold tracking-tight">0arc AI</h1>
          <p className="mt-0.5 text-[11px] text-zinc-500">Archive assistant · Groq</p>
        </div>
        <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] text-zinc-500">Archive context</span>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-[42vh] max-w-xl flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.09] bg-white/[0.04]">
              <Bot className="h-6 w-6 text-zinc-200" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">How can I help with your archive?</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-zinc-500">
              Ask about your saved tools, notes, and watchlist. The assistant can read archive context and suggest ideas, but it won&apos;t change or delete anything.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={isLoading}
                  onClick={() => void sendMessage(prompt)}
                  className="rounded-xl border border-white/[0.09] bg-white/[0.025] px-3.5 py-2.5 text-left text-xs text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            {messages.map((message, index) => (
              <article key={`${index}-${message.role}`} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
                    <Sparkles className="h-3.5 w-3.5 text-zinc-200" aria-hidden="true" />
                  </div>
                )}
                <div className={`max-w-[85%] break-words text-sm leading-7 ${message.role === 'user' ? 'whitespace-pre-wrap rounded-2xl bg-[#202023] px-4 py-2.5 text-zinc-100' : 'pt-0.5 text-zinc-300 [&_a]:text-zinc-100 [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:my-2 [&_strong]:font-semibold [&_table]:min-w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2'}`}>
                  {message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : message.content}
                </div>
              </article>
            ))}
            {isLoading && (
              <div className="flex items-center gap-3 text-xs text-zinc-500" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                Thinking…
              </div>
            )}
            {error && <p className="ml-10 text-xs text-rose-300" role="alert">{error}</p>}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {messages.length === 0 && error && <p className="px-6 pb-2 text-center text-xs text-rose-300" role="alert">{error}</p>}

      <div className="border-t border-white/[0.07] bg-[#09090b] px-3 pb-3 pt-3 sm:px-6 sm:pb-5">
        <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-white/[0.12] bg-[#151517] p-2 shadow-lg transition focus-within:border-white/25">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              maxLength={2000}
              rows={2}
              placeholder="Message 0arc AI…"
              aria-label="Message 0arc AI"
              className="max-h-36 min-h-12 w-full resize-y bg-transparent px-2 py-2 text-sm leading-6 text-white outline-none placeholder:text-zinc-600"
            />
            <div className="flex items-center justify-between gap-3 px-1 pb-0.5">
              <p className="text-[10px] text-zinc-600">Selected archive text is processed by Groq. Read-only; no web access.</p>
              <button
                type="submit"
                disabled={!draft.trim() || isLoading}
                aria-label="Send message"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-zinc-600"
              >
                {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-600">AI can make mistakes. Verify important details.</p>
        </form>
      </div>
    </section>
  );
};
