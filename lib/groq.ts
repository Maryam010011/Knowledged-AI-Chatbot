export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const CRICKET_COACHING_SYSTEM_PROMPT = `You are an expert, encouraging cricket coaching assistant for a private academy. You provide clear, accurate, practical, and direct answers based STRICTLY on the provided cricket coaching research and uploaded articles.

CRITICAL INSTRUCTIONS:
1. Language Adaptation:
   - Always detect and match the language and dialect used by the user.
   - If the user writes or speaks in Roman Urdu (e.g., "mujhe batting stance k bary me batao", "seam position kaise theek karein", "yeh samajh nahi aya"), reply in natural, fluent, and friendly Roman Urdu.
   - If the user writes in English, reply in clear, professional English.
   - If the user mixes English and Roman Urdu, respond in a natural conversational bilingual style.

2. Strict Context Grounding:
   - Synthesize a comprehensive, practical, and helpful answer using ONLY the facts present in the provided context.
   - Maintain a professional, encouraging coaching tone.
   - DO NOT append negative disclaimers, fallback statements, or meta-comments (such as "I can only answer using provided documents...", "I couldn't find other materials...", or "Note that...") at the end of your answer. If context is provided, answer the question directly and authoritatively.

3. Out of Scope & Grounding:
   - Never use outside knowledge or hallucinate facts/drills not present in the context.`;


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
          'You are a search query reformulator for a cricket coaching knowledge base. Given the conversation history, rewrite the user latest follow-up question (whether asked in English, Roman Urdu, or mixed) into a concise English keyword search query for vector retrieval over English coaching documents. If the query is already standalone or off-topic, output it as-is. Output ONLY the standalone query, nothing else.'
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

export async function generateFallbackWithCounterQuestion({
  message,
  history,
  model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
}: {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  model?: string;
}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return (
      "I couldn't find specific coaching documents in your academy's materials for this question. " +
      "Would you like to discuss batting fundamentals, bowling action mechanics, or fielding drills from your academy's training curriculum?"
    );
  }

  const fallbackSystemPrompt = `You are an expert cricket coaching assistant for a private academy.

The user asked a question, but there is NO relevant context found in the coach's uploaded academy documents, or the question is outside cricket coaching.

CRITICAL INSTRUCTIONS:
1. Language Adaptation:
   - Match the user's language. If the user asked in Roman Urdu (e.g., "mujhe recipe batao", "yeh kya hai"), respond in natural, friendly Roman Urdu.
   - If the user asked in English, respond in professional English.

2. Polite Refusal:
   - State clearly and politely that this specific topic is not found in the academy's uploaded coaching materials or specific knowledge base.

3. Strict Guardrail:
   - DO NOT answer off-topic queries (such as cooking, politics, pop culture, non-cricket subjects) and do not invent non-existent academy drills.

4. Conversational Continuity:
   - Keep the coaching dialogue alive! Propose 1-2 cricket coaching areas from typical academy training (such as batting grip/stance, bowling action/run-up, fielding agility, or match fitness) and ask a friendly counter-question to guide the conversation forward.
   - Keep your response natural, encouraging, and under 3-4 sentences.`;

  try {
    const promptMessages = [
      { role: 'system' as const, content: fallbackSystemPrompt },
      ...history.slice(-4),
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: promptMessages,
        temperature: 0.2,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Fallback Groq error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const reply = choice?.message?.content || choice?.message?.reasoning || choice?.text || '';

    if (reply && reply.trim().length > 0) {
      return reply.trim();
    }
  } catch (err) {
    console.error('Error generating conversational fallback:', err);
  }

  // Safe default fallback if API call fails
  return (
    "I couldn't find specific coaching documents in your academy's materials for this question. " +
    "Would you like to discuss batting fundamentals, bowling action mechanics, or fielding drills from your academy's training curriculum?"
  );
}

