import 'server-only';

type GlobalWithStartupFlag = typeof globalThis & {
  __opiniaStartupEnvChecked?: boolean;
};

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function runStartupEnvCheck(): void {
  const globalRef = globalThis as GlobalWithStartupFlag;
  if (globalRef.__opiniaStartupEnvChecked) return;
  globalRef.__opiniaStartupEnvChecked = true;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const problems: string[] = [];

  if (!supabaseUrl) {
    problems.push('NEXT_PUBLIC_SUPABASE_URL no està definit.');
  } else {
    if (!isValidHttpUrl(supabaseUrl)) {
      problems.push(`NEXT_PUBLIC_SUPABASE_URL no és una URL vàlida: "${supabaseUrl}".`);
    }
    if (supabaseUrl.includes('placeholder')) {
      problems.push(
        'NEXT_PUBLIC_SUPABASE_URL apunta a un placeholder. Configura la URL real del projecte Supabase.',
      );
    }
  }

  if (!anonKey) {
    problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY no està definit.');
  }

  if (problems.length === 0) return;

  console.error(
    [
      '[startup-env-check] Configuració Supabase invàlida detectada.',
      ...problems.map((problem) => `- ${problem}`),
      '- Revisa .env.local (local) o Environment Variables (Vercel).',
    ].join('\n'),
  );
}
