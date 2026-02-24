import type { KBEntry } from '@/types/database';

const cache = new Map<string, { entries: KBEntry[]; ts: number }>();
const TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedKB(
  supabase: any,
  bizId: string
): Promise<KBEntry[]> {
  const key = `kb:${bizId}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.ts < TTL) {
    return cached.entries;
  }

  const { data } = await supabase
    .from('kb_entries')
    .select('*')
    .eq('biz_id', bizId)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  const entries = (data as KBEntry[]) || [];
  cache.set(key, { entries, ts: Date.now() });
  return entries;
}

export function invalidateKBCache(bizId: string) {
  cache.delete(`kb:${bizId}`);
}
