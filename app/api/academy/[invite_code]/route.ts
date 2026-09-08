import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  req: Request,
  { params }: { params: { invite_code: string } }
) {
  try {
    const inviteCode = params.invite_code;
    if (!inviteCode) {
      return NextResponse.json({ error: 'Invite code required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: org, error } = await admin
      .from('organizations')
      .select('id, name')
      .eq('invite_code', inviteCode.trim())
      .single();

    if (error || !org) {
      return NextResponse.json({ error: 'Academy not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: org.id,
      name: org.name,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
