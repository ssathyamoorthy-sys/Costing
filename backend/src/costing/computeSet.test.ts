import { describe, expect, it } from 'vitest';
import { checkYarnDyedMoq } from './computeSet';

describe('checkYarnDyedMoq', () => {
  it('does not apply when no threshold is configured (no setting, no override)', () => {
    const result = checkYarnDyedMoq({
      productCode: 'PDD',
      segmentTotalKg: 50,
      moqThreshold: null,
      baseRejectionPct: 0.03,
      moqShortfallRejectionPct: 0.05,
    });
    expect(result.underMoq).toBe(false);
    expect(result.effectiveRejectionPct).toBe(0.03);
    expect(result.warning).toBeNull();
  });

  it('does not apply when the order meets or exceeds the threshold', () => {
    const atThreshold = checkYarnDyedMoq({
      productCode: 'PDD',
      segmentTotalKg: 1000,
      moqThreshold: 1000,
      baseRejectionPct: 0.03,
      moqShortfallRejectionPct: 0.05,
    });
    expect(atThreshold.underMoq).toBe(false);
    expect(atThreshold.effectiveRejectionPct).toBe(0.03);

    const aboveThreshold = checkYarnDyedMoq({
      productCode: 'PDD',
      segmentTotalKg: 1500,
      moqThreshold: 1000,
      baseRejectionPct: 0.03,
      moqShortfallRejectionPct: 0.05,
    });
    expect(aboveThreshold.underMoq).toBe(false);
  });

  it('bumps rejectionPct and returns a warning when under the threshold', () => {
    const result = checkYarnDyedMoq({
      productCode: 'PDD',
      segmentTotalKg: 400,
      moqThreshold: 1000,
      baseRejectionPct: 0.03,
      moqShortfallRejectionPct: 0.05,
    });
    expect(result.underMoq).toBe(true);
    expect(result.effectiveRejectionPct).toBeCloseTo(0.08);
    expect(result.warning).toContain('PDD');
    expect(result.warning).toContain('400kg');
    expect(result.warning).toContain('1000kg');
    expect(result.warning).toContain('5.0%');
  });

  it('uses the per-product override threshold over the general one when given', () => {
    // Caller is expected to resolve product.yarnDyedMoqKgOverride ?? generalMoqKg before
    // calling this function - this test just confirms the function uses whatever threshold
    // it's handed, i.e. an order of 800kg passes a 500kg (overridden) threshold but would
    // have failed the hypothetical 1000kg general default.
    const result = checkYarnDyedMoq({
      productCode: 'PWD',
      segmentTotalKg: 800,
      moqThreshold: 500,
      baseRejectionPct: 0.03,
      moqShortfallRejectionPct: 0.05,
    });
    expect(result.underMoq).toBe(false);
  });
});
