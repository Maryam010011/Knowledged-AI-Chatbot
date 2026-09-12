export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const CRICKET_COACHING_SYSTEM_PROMPT = `You are an expert cricket coaching assistant. You provide clear, accurate, and direct answers based STRICTLY on the provided cricket coaching research and articles.

Instructions:
1. Synthesize a comprehensive, well-structured, and helpful answer using ONLY the facts present in the provided context.
2. Maintain a professional, encouraging coaching tone.
3. DO NOT append negative disclaimers, fallback statements, or meta-comments (such as "I can only answer using provided documents...", "I couldn't find other materials...", or "Note that...") at the end of your answer. If context is provided, answer the question directly and stop.
4. If the provided context is completely insufficient or irrelevant to answer the user's question, respond ONLY with: "I couldn't find sufficient details on this specific topic in your academy's uploaded materials."
5. Never use outside knowledge or hallucinate facts not present in the context.`;

export async function callGroqChatCompletion({
  messages,
  contextChunks,
  model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
}: {
  messages: { role: 'user' | 'assistant'; content: string }[];
  contextChunks: string[];
  model?: string;
}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const formattedContext = contextChunks.length > 0
    ? contextChunks.map((c, i) => `[Source ${i + 1}]:\n${c}`).join('\n\n---\n\n')
    : 'No relevant coaching documents found.';

  const systemContent = `${CRICKET_COACHING_SYSTEM_PROMPT}\n\nContext:\n${formattedContext}`;

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemContent },
      ...messages.slice(-6), // Keep recent conversation turns
    ],
    temperature: 0.15, // Low temperature for maximum factual fidelity to context
    max_tokens: 1500,
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Groq API error:', response.status, errorBody);
    throw new Error(`Groq API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('No completion choice returned from Groq');
  }

  const content = choice.message?.content || choice.text || '';
  if (!content && choice.message?.reasoning) {
    return choice.message.reasoning;
  }

  return content;
}

export async function reformulateFollowUpQuery({
  message,
  history,
}: {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || history.length === 0) {
    return message;
  }

  try {
    const prompt = [
      {
        role: 'system',
        content:
          'You are a search query reformulator for a cricket coaching knowledge base. Given the conversation history, rewrite the user latest follow-up question into a standalone, concise keyword search query for vector retrieval. If the query is already standalone or off-topic, output it as-is. Output ONLY the standalone query, nothing else.'
      },
      ...history.slice(-4),
      { role: 'user', content: message }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: prompt,
        temperature: 0.1,
        max_tokens: 80,
      }),
    });

    if (!response.ok) return message;
    const data = await response.json();
    const result = data.choices?.[0]?.message?.content;
    if (result && result.trim().length > 0) {
      return result.trim().replace(/^["']|["']$/g, '');
    }
    return message;
  } catch (err) {
    console.error('Error reformulating query:', err);
    return message;
  }
}

