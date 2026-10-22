import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalApiKey = process.env.ANTHROPIC_API_KEY;

const master = {
  products: [{ id: 1, code: 'PDD', name: 'Plain Dyed Dobby' }],
  rawMaterials: [{ id: 2, code: '1/16s K', description: null }],
  itemTypes: [{ id: 3, name: 'Bath Towel' }],
  hsnCodes: [{ id: 4, hsCode: '5802', description: 'Terry towelling' }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe('extractQuoteFromInput', () => {
  it('throws AiExtractNotConfiguredError and makes no network call when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const parseSpy = vi.fn();
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { parse: parseSpy };
      },
    }));

    const { extractQuoteFromInput, AiExtractNotConfiguredError } = await import('./aiExtract');
    await expect(extractQuoteFromInput({ kind: 'text', text: 'hi', sourceLabel: 'pasted email/WhatsApp text' }, master)).rejects.toBeInstanceOf(
      AiExtractNotConfiguredError,
    );
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('returns parsed_output unchanged when the model returns a usable extraction', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const canned = {
      customer: { matchedId: null, guessedText: 'Acme Towels', confidence: 'low' },
      color: 'White',
      qtySets: 500,
      targetPrice: null,
      segments: [],
      warnings: [],
    };
    const parseSpy = vi.fn().mockResolvedValue({ parsed_output: canned });
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { parse: parseSpy };
      },
    }));

    const { extractQuoteFromInput } = await import('./aiExtract');
    const result = await extractQuoteFromInput({ kind: 'text', text: 'hi', sourceLabel: 'pasted email/WhatsApp text' }, master);
    expect(result).toEqual(canned);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    const call = parseSpy.mock.calls[0][0];
    expect(call.system).toContain('PDD');
    expect(call.output_config.effort).toBe('low');
  });

  it('throws when the model returns no parsed_output', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const parseSpy = vi.fn().mockResolvedValue({ parsed_output: null });
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { parse: parseSpy };
      },
    }));

    const { extractQuoteFromInput } = await import('./aiExtract');
    await expect(extractQuoteFromInput({ kind: 'text', text: 'hi', sourceLabel: 'pasted email/WhatsApp text' }, master)).rejects.toThrow(
      'AI did not return a usable extraction',
    );
  });

  it('passes an image content block + text block for image input', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const parseSpy = vi.fn().mockResolvedValue({
      parsed_output: { customer: null, color: null, qtySets: null, targetPrice: null, segments: [], warnings: [] },
    });
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class {
        messages = { parse: parseSpy };
      },
    }));

    const { extractQuoteFromInput } = await import('./aiExtract');
    await extractQuoteFromInput({ kind: 'image', base64: 'ZmFrZQ==', mediaType: 'image/png' }, master);
    const content = parseSpy.mock.calls[0][0].messages[0].content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZQ==' } });
    expect(content[1].type).toBe('text');
  });
});
