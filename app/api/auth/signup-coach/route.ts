import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidEmail } from '@/lib/email-validator';

export async function POST(req: Request) {
  try {
    const { email, password, fullName, academyName } = await req.json();

    if (!email || !password || !academyName) {
      return NextResponse.json(
        { error: 'Email, password, and Academy name are required.' },
        { status: 400 }
      );
    }

    const emailCheck = isValidEmail(email);
    if (!emailCheck.valid) {
      return NextResponse.json({ error: emailCheck.reason }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Create auth user with Supabase Admin
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm for coach setup
      user_metadata: { full_name: fullName || 'Coach' }
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Failed to create coach account' },
        { status: 400 }
      );
    }

    const userId = authData.user.id;

    // 2. Create organization
    // Generate an 8-char alphanumeric invite code
    const inviteCode = Math.random().toString(36).substring(2, 10);
    const { data: orgData, error: orgError } = await adminClient
      .from('organizations')
      .insert({
        name: academyName.trim(),
        invite_code: inviteCode
      })
      .select()
      .single();

    if (orgError || !orgData) {
      // rollback user
      await adminClient.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: `Database error creating organization: ${orgError?.message}` },
        { status: 500 }
      );
    }

    // 3. Create profile as admin
    const { error: profileError } = await adminClient
      .from('profiles')
      .insert({
        id: userId,
        organization_id: orgData.id,
        role: 'admin',
        full_name: fullName || 'Coach'
      });

    if (profileError) {
      // rollback organization and user
      await adminClient.from('organizations').delete().eq('id', orgData.id);
      await adminClient.auth.admin.deleteUser(userId);
      return NextResponse.json(
        { error: `Database error creating profile: ${profileError?.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: { id: userId, email },
      organization: orgData,
    });
  } catch (error: any) {
    console.error('Coach signup error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error during registration' },
      { status: 500 }
    );
  }
}
