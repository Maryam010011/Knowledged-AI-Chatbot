import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: Request) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin' || !profile?.organization_id) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const admin = createAdminClient();

    // Get all profiles for this organization
    const { data: members, error } = await admin
      .from('profiles')
      .select(`
        id,
        full_name,
        role,
        created_at,
        conversations(count)
      `)
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch auth emails
    const { data: authUsers } = await admin.auth.admin.listUsers();
    const emailMap = new Map(authUsers.users.map(u => [u.id, u.email]));

    const formatted = (members || []).map((m: any) => ({
      id: m.id,
      full_name: m.full_name || 'Anonymous',
      role: m.role,
      email: emailMap.get(m.id) || 'Unknown',
      created_at: m.created_at,
      conversationCount: m.conversations?.[0]?.count || 0,
    }));

    return NextResponse.json({ members: formatted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
