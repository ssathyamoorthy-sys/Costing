import Anthropic from '@anthropic-ai/sdk';
// zodOutputFormat only understands schemas built with zod's "v4" API (internally it calls
// z.toJSONSchema from zod/v4). The rest of this codebase uses classic zod (import { z } from
// 'zod'), which is a different object shape and crashes inside the SDK helper - so this file
// alone imports from the zod/v4 subpath (already bundled in the installed zod@3.25.x, no
// version bump needed). .safeParse() on a zod/v4 schema works the same as classic zod.
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

// Cheap, fast, vision-capable - good fit for a single-shot extraction task. Override via env
// if extraction quality on messy screenshots needs a stronger model (e.g. claude-sonnet-5-5).
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export class AiExtractNotConfiguredError extends Error {}

const confidence = z.enum(['high', 'low', 'none']);
const matchRef = () => z.object({ matchedId: z.number().int().positive().nullable(), guessedText: z.string(), confidence });

export const ExtractionResultSchema = z.object({
  customer: matchRef().nullable(),
  color: z.string().nullable(),
  qtySets: z.number().nullable(),
  targetPrice: z.number().nullable(),
  segments: z.array(
    z.object({
      product: matchRef(),
      yarnComponents: z.array(z.object({ slot: z.string(), rawMaterial: matchRef(), mixingPct: z.number().nullable() })),
      items: z.array(
        z.object({
          itemType: matchRef(),
          lengthCm: z.number().nullable(),
          widthCm: z.number().nullable(),
          gsm: z.number().nullable(),
          qtyPerSet: z.number().nullable(),
          hsnCode: matchRef(),
        }),
      ),
    }),
  ),
  warnings: z.array(z.string()),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface MasterDataContext {
  customers?: { id: number; name: string }[];
  products: { id: number; code: string; name: string | null }[];
  rawMaterials: { id: number; code: string; description: string | null }[];
  itemTypes: { id: number; name: string }[];
  hsnCodes: { id: number; hsCode: string; description: string }[];
}

function formatList(rows: { id: number }[], render: (row: any) => string): string {
  if (rows.length === 0) return '(none on file)';
  return rows.map((r) => `${r.id}: ${render(r)}`).join('\n');
}

function buildSystemPrompt(master: MasterDataContext): string {
  const sections = [
    `You read customer product inquiries (screenshots, spreadsheets, or pasted emails/WhatsApp messages) for a terry towel manufacturer and extract a structured quote draft.`,
    master.customers
      ? `Existing customers (id: name):\n${formatList(master.customers, (c) => c.name)}`
      : `The quote already has a fixed customer - do not try to identify one.`,
    `Existing products (id: code / name):\n${formatList(master.products, (p) => `${p.code}${p.name ? ' / ' + p.name : ''}`)}`,
    `Existing raw materials / yarns (id: code / description):\n${formatList(master.rawMaterials, (r) => `${r.code}${r.description ? ' / ' + r.description : ''}`)}`,
    `Existing item types (id: name):\n${formatList(master.itemTypes, (i) => i.name)}`,
    `Existing HSN codes (id: hsCode / description):\n${formatList(master.hsnCodes, (h) => `${h.hsCode} / ${h.description}`)}`,
    [
      `For the customer (if applicable), product, each yarn raw material, each item type, and each HSN code, try to match the text you read against the lists above.`,
      `Set matchedId only when you are reasonably confident it's the same real-world thing (exact or near-exact code/name match). Otherwise leave matchedId null and put your best-guess raw text in guessedText so a human can pick the closest real record.`,
      `Rate your own confidence per field as "high" (clear match), "low" (plausible guess), or "none" (no real signal).`,
    ].join(' '),
    [
      `Domain hints: GSM is grams per square meter. Yarn recipe slots are typically named Ground, Pile, Weft, or Scoured.`,
      `Within one product segment, the yarn components' mixingPct values should sum to roughly 100 - if the source clearly implies a recipe that doesn't, add a note to warnings instead of silently fixing it.`,
      `Leave a numeric field null rather than guessing a value the source doesn't state.`,
      `Do not fabricate any data not present in the source material.`,
    ].join(' '),
  ];
  return sections.join('\n\n');
}

export type ExtractInput =
  | { kind: 'image'; base64: string; mediaType: string }
  | { kind: 'text'; text: string; sourceLabel: 'pasted email/WhatsApp text' | 'uploaded spreadsheet' };

export async function extractQuoteFromInput(input: ExtractInput, master: MasterDataContext): Promise<ExtractionResult> {
  const anthropic = getClient();
  if (!anthropic) throw new AiExtractNotConfiguredError();

  const content: Anthropic.ContentBlockParam[] =
    input.kind === 'image'
      ? [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType as any, data: input.base64 } },
          { type: 'text', text: 'Extract the quote inquiry from this screenshot.' },
        ]
      : [{ type: 'text', text: `Extract the quote inquiry from this ${input.sourceLabel}:\n\n${input.text}` }];

  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(master),
    output_config: { effort: 'low', format: zodOutputFormat(ExtractionResultSchema) },
    messages: [{ role: 'user', content }],
  });

  if (!response.parsed_output) throw new Error('AI did not return a usable extraction');
  return response.parsed_output;
}
