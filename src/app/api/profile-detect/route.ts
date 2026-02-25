export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { buildProfileDetectPrompt } from '@/lib/prompts';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { validateBody, ProfileDetectSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  // Auth check
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized', message: 'Auth required' }, { status: 401 });

  try {
    const [body, err] = await validateBody(request, ProfileDetectSchema);
    if (err) return err;

    const { url } = body;

    const apiKey = process.env.OPENAI_API_KEY;

    // If no API key, use heuristic detection
    if (!apiKey) {
      return NextResponse.json(heuristicDetect(url));
    }

    // Use OpenAI for smart detection
    const prompt = buildProfileDetectPrompt(url);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.statusText);
      return NextResponse.json(heuristicDetect(url));
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    try {
      const cleaned = content.replace(/```json\n?|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json(heuristicDetect(url));
    }
  } catch (error) {
    console.error('Profile detect error:', error);
    return NextResponse.json(
      { error: 'Failed to detect profile' },
      { status: 500 }
    );
  }
}

function heuristicDetect(url: string) {
  const urlLower = url.toLowerCase();
  let domain = '';
  try {
    domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    domain = url;
  }

  // Clean domain for business name
  const nameParts = domain
    .replace(/^www\./, '')
    .split('.')[0]
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Detect type
  let type: string = 'restaurant';
  if (urlLower.includes('hotel') || urlLower.includes('hostal') || urlLower.includes('h10')) type = 'hotel';
  else if (urlLower.includes('apart') || urlLower.includes('airbnb') || urlLower.includes('booking')) type = 'apartment';
  else if (urlLower.includes('bar') || urlLower.includes('pub')) type = 'bar';
  else if (urlLower.includes('cafe') || urlLower.includes('coffee')) type = 'cafe';

  // Detect language from TLD/content
  let lang = 'ca';
  if (urlLower.includes('.es') || urlLower.includes('spain')) lang = 'es';
  else if (urlLower.includes('.com') && !urlLower.includes('.cat')) lang = 'en';
  else if (urlLower.includes('.cat')) lang = 'ca';
  else if (urlLower.includes('.fr')) lang = 'fr';

  // Generate tags based on type
  const tagMap: Record<string, string[]> = {
    restaurant: ['gastronomia', 'cuina mediterrània', 'servei'],
    hotel: ['allotjament', 'hospitalitat', 'confort'],
    apartment: ['apartament turístic', 'estada', 'llar'],
    bar: ['begudes', 'ambient', 'nit'],
    cafe: ['cafè', 'esmorzars', 'ambient'],
    shop: ['botiga', 'productes', 'atenció'],
    other: ['negoci', 'servei', 'qualitat'],
  };

  return {
    business_name: nameParts || 'El Meu Negoci',
    business_type: type,
    tags: tagMap[type] || tagMap.other,
    default_signature: `L'equip de ${nameParts || 'El Meu Negoci'}`,
    formality_default: type === 'hotel' ? 'voste' : 'tu',
    language_default: lang,
  };
}
