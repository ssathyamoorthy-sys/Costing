import { describe, expect, it } from 'vitest';
import { evaluateScenarioRulesForItem, type ScenarioRuleInput } from './computeSet';

const yarnDyedProduct = { id: 4, colorMethod: 'YARN_DYED' };
const pieceDyedProduct = { id: 5, colorMethod: 'PIECE_DYED' };

function rule(overrides: Partial<ScenarioRuleInput> = {}): ScenarioRuleInput {
  return {
    id: 1,
    name: 'Test rule',
    scopeType: 'ALL',
    scopeProductId: null,
    conditionField: 'ORDER_QTY_KG',
    conditionOperator: '<',
    conditionValue: 1000,
    actionField: 'REJECTION_PCT',
    actionValue: 0.05,
    ...overrides,
  };
}

describe('evaluateScenarioRulesForItem', () => {
  it('matches nothing when there are no rules', () => {
    const result = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 100, itemGsm: 500, rules: [] });
    expect(result.matched).toHaveLength(0);
    expect(result.rejectionPctDelta).toBe(0);
    expect(result.weavingSizingCostPerKgDelta).toBe(0);
  });

  it('matches an ALL-scope rule regardless of colorMethod', () => {
    const r = rule({ scopeType: 'ALL', conditionField: 'GSM', conditionOperator: '<', conditionValue: 400, actionField: 'WEAVING_SIZING_COST_PER_KG', actionValue: 2 });
    const result = evaluateScenarioRulesForItem({ product: pieceDyedProduct, segmentTotalKg: 5000, itemGsm: 350, rules: [r] });
    expect(result.matched).toHaveLength(1);
    expect(result.weavingSizingCostPerKgDelta).toBeCloseTo(2);
  });

  it('a COLOR_METHOD_YARN_DYED rule matches yarn-dyed only', () => {
    const r = rule({ scopeType: 'COLOR_METHOD_YARN_DYED' });
    const matchesYarnDyed = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [r] });
    expect(matchesYarnDyed.matched).toHaveLength(1);

    const skipsPieceDyed = evaluateScenarioRulesForItem({ product: pieceDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [r] });
    expect(skipsPieceDyed.matched).toHaveLength(0);
  });

  it('a PRODUCT-scoped rule matches only that product id', () => {
    const r = rule({ scopeType: 'PRODUCT', scopeProductId: 4 });
    const matches = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [r] });
    expect(matches.matched).toHaveLength(1);

    const other = evaluateScenarioRulesForItem({ product: { id: 99, colorMethod: 'YARN_DYED' }, segmentTotalKg: 400, itemGsm: 500, rules: [r] });
    expect(other.matched).toHaveLength(0);
  });

  it('evaluates ORDER_QTY_KG against segmentTotalKg and GSM against itemGsm independently', () => {
    const qtyRule = rule({ conditionField: 'ORDER_QTY_KG', conditionOperator: '<', conditionValue: 1000 });
    const gsmRule = rule({ id: 2, conditionField: 'GSM', conditionOperator: '<', conditionValue: 400, actionField: 'WEAVING_SIZING_COST_PER_KG', actionValue: 1.5 });

    // Under the qty threshold but GSM is not under its threshold - only the qty rule fires.
    const r1 = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 500, itemGsm: 550, rules: [qtyRule, gsmRule] });
    expect(r1.matched.map((m) => m.rule.id)).toEqual([1]);
    expect(r1.rejectionPctDelta).toBeCloseTo(0.05);
    expect(r1.weavingSizingCostPerKgDelta).toBe(0);

    // Over the qty threshold but GSM is under its own - only the GSM rule fires.
    const r2 = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 5000, itemGsm: 350, rules: [qtyRule, gsmRule] });
    expect(r2.matched.map((m) => m.rule.id)).toEqual([2]);
    expect(r2.weavingSizingCostPerKgDelta).toBeCloseTo(1.5);
  });

  it('supports all five comparison operators', () => {
    const ops: [string, number, number, boolean][] = [
      ['<', 5, 10, true],
      ['<', 10, 5, false],
      ['<=', 10, 10, true],
      ['>', 10, 5, true],
      ['>=', 10, 10, true],
      ['==', 10, 10, true],
      ['==', 10, 11, false],
    ];
    for (const [operator, value, threshold, shouldMatch] of ops) {
      const r = rule({ conditionField: 'GSM', conditionOperator: operator, conditionValue: threshold });
      const result = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 0, itemGsm: value, rules: [r] });
      expect(result.matched.length > 0).toBe(shouldMatch);
    }
  });

  it('stacks deltas across different action fields from different matched rules', () => {
    const rejectionRule = rule({ id: 1, actionField: 'REJECTION_PCT', actionValue: 0.05 });
    const weavingRule = rule({ id: 2, conditionField: 'GSM', conditionValue: 1000, actionField: 'WEAVING_SIZING_COST_PER_KG', actionValue: 3 });
    const result = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [rejectionRule, weavingRule] });
    expect(result.matched).toHaveLength(2);
    expect(result.rejectionPctDelta).toBeCloseTo(0.05);
    expect(result.weavingSizingCostPerKgDelta).toBeCloseTo(3);
  });

  it('most-specific scope wins when two rules target the same action field', () => {
    const general = rule({ id: 1, scopeType: 'COLOR_METHOD_YARN_DYED', actionValue: 0.05 });
    const specific = rule({ id: 2, scopeType: 'PRODUCT', scopeProductId: 4, actionValue: 0.02 });
    const result = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [general, specific] });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].rule.id).toBe(2);
    expect(result.rejectionPctDelta).toBeCloseTo(0.02);
  });

  it('higher id wins when two rules of equal scope specificity target the same field', () => {
    const older = rule({ id: 1, scopeType: 'ALL', actionValue: 0.03 });
    const newer = rule({ id: 2, scopeType: 'ALL', actionValue: 0.07 });
    const result = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [older, newer] });
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].rule.id).toBe(2);
    expect(result.rejectionPctDelta).toBeCloseTo(0.07);
  });

  it('inactive/unknown action fields are never matched (ignored, not errored)', () => {
    const r = rule({ actionField: 'SOME_FUTURE_FIELD' as ScenarioRuleInput['actionField'] });
    const result = evaluateScenarioRulesForItem({ product: yarnDyedProduct, segmentTotalKg: 400, itemGsm: 500, rules: [r] });
    expect(result.matched).toHaveLength(0);
  });
});
