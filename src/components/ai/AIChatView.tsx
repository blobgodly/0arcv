import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, LoaderCircle, Sparkles } from 'lucide-react';

type ArchiveChangeProposal = {
  collection: 'tools' | 'notes' | 'watchlist';
  operation: 'add' | 'update';
  targetId?: string;
  summary: string;
  fields: Record<string, unknown>;
  confirmationToken: string;
  expiresAt: number;
};
type Citation = { title: string; url: string };
type ChatMessage = { role: 'user' | 'assistant'; content: string; citations?: Citation[]; pendingChange?: ArchiveChangeProposal; applied?: boolean };

export const AIChatView: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);
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
      const payload = typeof result.reply === 'string' ? { reply: result.reply } : result.reply;
      if (!response.ok || !result.ok || !payload || typeof payload.reply !== 'string') {
        throw new Error(result.error || 'The assistant could not respond. Please try again.');
      }
      setMessages((current) => [...current, {
        role: 'assistant',
        content: payload.reply,
        citations: Array.isArray(payload.citations) ? payload.citations : Array.isArray(result.citations) ? result.citations : [],
        pendingChange: payload.pendingChange || result.pendingChange,
      }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The assistant could not respond.');
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const applyProposal = async (proposal: ArchiveChangeProposal, messageIndex: number) => {
    setApplyingIndex(messageIndex);
    setError('');
    try {
      const response = await fetch('/api/ai/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not apply the proposed change.');
      setMessages((current) => [
        ...current.map((message, index) => index === messageIndex ? { ...message, pendingChange: undefined, applied: true } : message),
        { role: 'assistant', content: result.summary },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the proposed change.');
    } finally {
      setApplyingIndex(null);
    }
  };

  const dismissProposal = (messageIndex: number) => {
    setMessages((current) => current.map((message, index) => index === messageIndex ? { ...message, pendingChange: undefined, applied: false } : message));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  return (
    <section className="mx-auto flex h-full min-h-[calc(100dvh-7rem)] max-w-4xl flex-col overflow-hidden bg-[#09090b] text-zinc-100">
      <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 ? (
          <div className="mx-auto flex min-h-[46vh] max-w-xl flex-col items-center justify-center text-center">
            <Sparkles className="mb-5 h-7 w-7 text-zinc-200" aria-label="AI assistant" />
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">How can I help?</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-400">
              Ask about anything online or in your archive. I can search the web, read your saved items, and suggest ideas.
            </p>
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
                <div className={`max-w-[85%] break-words text-sm leading-7 ${message.role === 'user' ? 'whitespace-pre-wrap rounded-2xl bg-[#202023] px-4 py-2.5 text-zinc-100' : 'pt-0.5 text-zinc-300'} `}>
                  <div className={message.role === 'assistant' ? '[&_a]:text-zinc-100 [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:my-2 [&_strong]:font-semibold [&_table]:min-w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:px-2 [&_th]:py-1 [&_ul]:my-2' : ''}>
                    {message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : message.content}
                  </div>
                  {Boolean(message.citations?.length) && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      <span>Google Search</span>
                      {message.citations?.map((citation) => (
                        <a key={citation.url} href={citation.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 underline underline-offset-2 hover:text-white">
                          {citation.title}
                        </a>
                      ))}
                    </div>
                  )}
                  {message.pendingChange && (
                    <div className="mt-4 max-w-xl rounded-2xl bg-[#171719] p-4">
                      <p className="text-xs font-semibold text-white">Review archive change</p>
                      <p className="mt-1 text-xs text-zinc-400">{message.pendingChange.summary}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={applyingIndex === index} onClick={() => void applyProposal(message.pendingChange!, index)} className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black hover:bg-zinc-200 disabled:opacity-50">
                          {applyingIndex === index ? 'Applying…' : 'Apply change'}
                        </button>
                        <button type="button" disabled={applyingIndex === index} onClick={() => dismissProposal(index)} className="rounded-lg px-3 py-2 text-xs text-zinc-400 hover:text-white disabled:opacity-50">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                  {message.applied === false && <p className="mt-2 text-xs text-zinc-500">Proposal dismissed.</p>}
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

      <div className="bg-[#09090b] px-3 pb-4 pt-3 sm:px-6 sm:pb-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-2xl">
          <div className="rounded-2xl bg-[#151517] p-2">
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
            <div className="flex items-center justify-end gap-3 px-1 pb-0.5">
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
        </form>
      </div>
    </section>
  );
};
