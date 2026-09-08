import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/chat';

  if (code) {
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

    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && sessionData?.user) {
      // Check user role
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, organization_id')
        .eq('id', sessionData.user.id)
        .single();

      if (profile?.role === 'admin') {
        return NextResponse.redirect(`${origin}/admin`);
      } else if (profile?.role === 'member') {
        return NextResponse.redirect(`${origin}/chat`);
      } else {
        return NextResponse.redirect(`${origin}/waiting?email=${encodeURIComponent(sessionData.user.email || '')}`);
      }
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=Authentication%20failed`);
}
