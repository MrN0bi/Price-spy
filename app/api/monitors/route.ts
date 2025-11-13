import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseService } from '@/lib/supabase';

const schema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  region: z.string().optional(),
  css_hint: z.string().optional(),
  email: z.string().email().optional(),
  slack_webhook: z.string().url().optional(),
  node_index: z.number().int().min(1).optional(), // NEW: selector match index (1-based)
});

export async function GET() {
  const { data, error } = await supabaseService
    .from('monitors')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ monitors: data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // parsed.data now includes node_index when sent from the frontend
  const { data, error } = await supabaseService
    .from('monitors')
    .insert(parsed.data)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ monitor: data });
}
