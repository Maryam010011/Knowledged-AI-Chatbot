import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateEmbedding } from '@/lib/embeddings';
import { callGroqChatCompletion, reformulateFollowUpQuery } from '@/lib/groq';

export const maxDuration = 60;

const SIMILARITY_THRESHOLD = 0.5; // Cosine similarity threshold for domain gate
const TOP_K = 5;

const DECLINE_MESSAGE =
  "I can only answer questions using the cricket coaching articles and research documents uploaded by your coach. " +
  "I couldn't find relevant coaching materials in your academy's knowledge base for this question, or your question is outside cricket coaching. " +
  "Please ask something related to cricket batting, bowling, fielding, or coaching techniques covered in your academy's materials.";

function sanitizeAssistantReply(reply: string): string {
  if (!reply) return reply;

  // Remove any accidental trailing LLM disclaimer sentence appended to a valid answer
  const disclaimerPattern = /(?:\n\n|\s)*(?:Note:?\s*)?(?:I can only answer questions using|I couldn't find (?:additional|more|relevant) coaching materials|Please ask something related to cricket)[\s\S]*$/i;

  // Only strip if there is substantive content before the match
  const match = reply.match(disclaimerPattern);
  if (match && match.index && match.index > 50) {
    return reply.slice(0, match.index).trim();
  }
  return reply.trim();
}

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Server-side user profile & organization lookup (never trust browser org_id)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json(
        { error: 'You are not assigned to an academy. Please contact your coach.' },
        { status: 403 }
      );
    }

    const orgId = profile.organization_id;
    const admin = createAdminClient();

    const { message, conversationId } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
    }

    // 1. Ensure conversation exists or create one
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const title = message.slice(0, 40) + (message.length > 40 ? '...' : '');
      const { data: newConv, error: convErr } = await admin
        .from('conversations')
        .insert({
          user_id: user.id,
          organization_id: orgId,
          title: title,
        })
        .select()
        .single();

      if (convErr || !newConv) {
        throw new Error(`Failed to create conversation: ${convErr?.message}`);
      }
      activeConversationId = newConv.id;
    }

    // 2. Retrieve recent conversation history (last 6 messages) BEFORE saving current message
    const { data: rawHistory } = await admin
      .from('messages')
      .select('role, content')
      .eq('conversation_id', activeConversationId)
      .order('created_at', { ascending: true })
      .limit(6);

    const historyMessages = (rawHistory || []).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // 3. Contextual Query Reformulation for follow-ups
    let searchTargetQuery = message;
    if (historyMessages.length > 0) {
      searchTargetQuery = await reformulateFollowUpQuery({
        message,
        history: historyMessages,
      });
    }

    // 4. Save user message to database
    await admin.from('messages').insert({
      conversation_id: activeConversationId,
      role: 'user',
      content: message,
    });

    // 5. Generate query embedding locally with Transformers.js (384 dims, all-MiniLM-L6-v2)
    const queryEmbedding = await generateEmbedding(searchTargetQuery);

    // 6. Vector similarity search against document_chunks via RPC function strictly for user's organization
    const { data: matchingChunks, error: matchError } = await admin.rpc(
      'match_document_chunks',
      {
        query_embedding: queryEmbedding,
        match_threshold: SIMILARITY_THRESHOLD,
        match_count: TOP_K,
        filter_organization_id: orgId,
      }
    );

    if (matchError) {
      console.error('RPC match_document_chunks error:', matchError);
    }

    const validChunks = (matchingChunks || []).filter((c: any) => c.similarity >= SIMILARITY_THRESHOLD);
    const bestSimilarity = validChunks.length > 0 ? validChunks[0].similarity : 0;

    let assistantReply = '';
    let sources: any[] = [];

    // 7. THRESHOLD CHECK & CASE SEPARATION
    if (validChunks.length === 0 || bestSimilarity < SIMILARITY_THRESHOLD) {
      // Check if this is a follow-up directly asking about or formatting the prior assistant response
      const lastAssistantMsg = historyMessages.filter(m => m.role === 'assistant').pop();
      const isRefiningPriorAnswer =
        lastAssistantMsg &&
        !lastAssistantMsg.content.includes("I can only answer questions using the cricket coaching articles") &&
        (message.toLowerCase().includes('summarize') ||
          message.toLowerCase().includes('bullet point') ||
          message.toLowerCase().includes('simplify') ||
          message.toLowerCase().includes('explain further') ||
          message.toLowerCase().includes('clarify'));

      if (isRefiningPriorAnswer) {
        const formattedHistoryWithCurrent = [
          ...historyMessages,
          { role: 'user' as const, content: message },
        ];
        const rawReply = await callGroqChatCompletion({
          messages: formattedHistoryWithCurrent,
          contextChunks: [],
        });
        assistantReply = sanitizeAssistantReply(rawReply);
        sources = [];
      } else {
        // CASE B: Out of domain or no relevant context found -> Fallback only, ZERO citations
        assistantReply = DECLINE_MESSAGE;
        sources = [];
      }
    } else {
      // CASE A: Relevant context found above 0.5 threshold -> Generate answer & citations
      const formattedHistoryWithCurrent = [
        ...historyMessages,
        { role: 'user' as const, content: message },
      ];

      const contextTexts = validChunks.map((c: any) => c.content);
      const rawReply = await callGroqChatCompletion({
        messages: formattedHistoryWithCurrent,
        contextChunks: contextTexts,
      });

      // Sanitize output to strip trailing disclaimer text if generated by LLM
      assistantReply = sanitizeAssistantReply(rawReply);

      sources = validChunks.map((c: any) => ({
        id: c.id,
        title: c.metadata?.title || 'Cricket Document',
        similarity: Math.round(c.similarity * 100),
        pageNumber: c.metadata?.pageNumber || c.metadata?.totalPages,
        preview: c.content.slice(0, 150) + '...',
      }));
    }

    // 8. Save assistant reply to database
    const { data: savedReply } = await admin
      .from('messages')
      .insert({
        conversation_id: activeConversationId,
        role: 'assistant',
        content: assistantReply,
      })
      .select()
      .single();

    return NextResponse.json({
      conversationId: activeConversationId,
      message: savedReply || { role: 'assistant', content: assistantReply },
      sources,
      bestSimilarity: Math.round(bestSimilarity * 100),
    });
  } catch (err: any) {
    console.error('Chat API error:', err);
    return NextResponse.json(
      { error: err.message || 'Error processing chat query' },
      { status: 500 }
    );
  }
}
