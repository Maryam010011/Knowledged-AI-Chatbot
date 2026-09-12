import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (code || (token_hash && type)) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    let authUser = null;

    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data?.user) authUser = data.user;
    } else if (token_hash && type) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash,
        type: type as any,
      });
      if (!error && data?.user) authUser = data.user;
    }

    if (authUser) {
      // Check user role from database
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, organization_id')
        .eq('id', authUser.id)
        .single();

      if (profile?.role === 'admin') {
        return NextResponse.redirect(`${origin}/admin`);
      } else if (profile?.role === 'member' && profile.organization_id) {
        return NextResponse.redirect(`${origin}/chat`);
      } else {
        return NextResponse.redirect(`${origin}/waiting?email=${encodeURIComponent(authUser.email || '')}`);
      }
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=Authentication%20failed`);
}
