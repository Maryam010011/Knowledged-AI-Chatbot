import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateEmbedding } from '@/lib/embeddings';
import { callGroqChatCompletion } from '@/lib/groq';

export const maxDuration = 60;

const SIMILARITY_THRESHOLD = 0.5; // Cosine similarity threshold for domain gate
const TOP_K = 5;

const DECLINE_MESSAGE = 
  "I can only answer questions using the cricket coaching articles and research documents uploaded by your coach. " +
  "I couldn't find relevant coaching materials in your academy's knowledge base for this question, or your question is outside cricket coaching. " +
  "Please ask something related to cricket batting, bowling, fielding, or coaching techniques covered in your academy's materials.";

export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's profile and organization
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

    // 2. Save user message to database
    await admin.from('messages').insert({
      conversation_id: activeConversationId,
      role: 'user',
      content: message,
    });

    // 3. Generate query embedding locally with Transformers.js
    const queryEmbedding = await generateEmbedding(message);

    // 4. Vector similarity search against document_chunks via RPC function
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

    const validChunks = matchingChunks || [];
    const bestSimilarity = validChunks.length > 0 ? validChunks[0].similarity : 0;

    let assistantReply = '';
    let sources: any[] = [];

    // 5. THRESHOLD CHECK: If no relevant chunks or below threshold, decline strictly!
    if (validChunks.length === 0 || bestSimilarity < SIMILARITY_THRESHOLD) {
      assistantReply = DECLINE_MESSAGE;
    } else {
      // 6. Fetch recent conversation history
      const { data: prevMessages } = await admin
        .from('messages')
        .select('role, content')
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: true })
        .limit(6);

      const formattedHistory = (prevMessages || []).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Call Groq LLM with context
      const contextTexts = validChunks.map((c: any) => c.content);
      assistantReply = await callGroqChatCompletion({
        messages: formattedHistory,
        contextChunks: contextTexts,
      });

      sources = validChunks.map((c: any) => ({
        id: c.id,
        title: c.metadata?.title || 'Cricket Document',
        similarity: Math.round(c.similarity * 100),
        pageNumber: c.metadata?.pageNumber || c.metadata?.totalPages,
        preview: c.content.slice(0, 150) + '...',
      }));
    }

    // 7. Save assistant reply to database
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
