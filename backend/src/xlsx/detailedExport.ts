import ExcelJS from 'exceljs';

export interface ItemSheetYarnRow {
  slot: string;
  materialCode: string;
  mixingPct: number;
  pricePerKg: number;
  overrideNote?: string | null;
  // Yarn-dyed only: cost/kg to dye this slot.
  dyeingCostPerKg?: number;
  // Yarn-dyed only: dye batch/shade label when this slot has multiple rows.
  dyeVariant?: string | null;
}
export interface ItemSheetAccessoryRow {
  name: string;
  costPerPiece: number;
}
export interface ItemSheetContext {
  quoteNo: string;
  customerEnquiryNo?: string | null;
  customerName: string;
  setNo: number;
  segmentLabel: string; // e.g. "PDD - Plain Dyed Dobby"
  itemTypeName: string;
  color: string;
  qtySets: number;
  currency: string;
  exchangeRateToInr: number; // INR value of 1 unit of `currency`; 1 for INR itself

  // PIECE_DYED (default): fabric is dyed as one piece after weaving, via a flat
  // Processing Charge. YARN_DYED: the yarn is dyed before weaving - each yarn row
  // carries its own dyeingCostPerKg instead, there's a yarn dyeing process loss stage
  // before weaving, and washing (washingCostPerKg/washingLossPct) replaces the
  // processing-charge stage, in the same chain position.
  colorMethod: 'PIECE_DYED' | 'YARN_DYED';
  // FLAT (default): sized by length x width x GSM (towels). GARMENT: sized by fabric
  // consumption in sq.m instead (bathrobes) - stitching becomes a flat per-piece cost, an
  // optional second sequential rejection stage is available, and export freight is costed
  // directly off the piece's own weight rather than the kg-chain's post-rejection yield.
  itemClass: 'FLAT' | 'GARMENT';

  // FLAT items only
  lengthCm: number;
  widthCm: number;
  // GARMENT items only
  fabricConsumptionSqm: number;
  gsm: number;
  qtyPerSet: number;

  weavingWastagePct: number;
  firstVelourLossPct: number;
  // PIECE_DYED only (paired with processingChargeRatePerKg)
  weightLossPct: number;
  // YARN_DYED only (paired with washingCostPerKg, same chain position as weightLossPct)
  washingLossPct: number;
  secondVelourLossPct: number;
  rejectionPct: number;
  // GARMENT only
  secondRejectionPct: number;
  // YARN_DYED only
  yarnDyeingProcessLossPct: number;

  yarnRows: ItemSheetYarnRow[];

  weavingSizingCostPerKg: number;
  firstVelourCharges: number;
  // PIECE_DYED only (color-driven)
  processingChargeRatePerKg: number;
  // YARN_DYED only (replaces processingChargeRatePerKg in the same chain position)
  washingCostPerKg: number;
  secondVelourCharges: number;
  transportLocalPerKg: number;
  // FLAT items use stitchingCostPerKg; GARMENT items use stitchingCostPerPiece instead.
  stitchingCostPerKg: number;
  stitchingCostPerPiece: number;
  packingCostPerKg: number;

  accessoryRows: ItemSheetAccessoryRow[];

  freightExportPerKg: number;
  wcInterestPct: number;
  lcInterestPct: number;
  marginPct: number;
  commissionPct: number;

  // Duty Drawback / RoDTEP - an internal profit metric only, never fed into the price
  // formula below. null when this item has no HSN code chosen.
  hsnCode: string | null;
  dbkPct: number;
  rosctlRodepPct: number;

  // CFR/CIF/Door Delivery only: this item's share of the quote's total container cost, in
  // the quote's own currency - a plain value (not itself a formula, since it depends on
  // every item in the whole quote, not just this sheet's inputs). undefined/0 when the
  // quote is FOB or has no container cost entered - see freightAllocation.ts.
  containerFreightPerPiece?: number;
}

const LABEL_FONT = { bold: true };
const TITLE_FONT = { bold: true, size: 13 };
const SECTION_FONT = { bold: true, italic: true };

/**
 * Writes one item's full cost chain to a worksheet as LIVE FORMULAS (a direct port of
 * costing/engine.ts's computeCosting, row for row, including its yarn-dyed and garment
 * branches) - every derived cell references the input cells above it, so a supervisor can
 * edit an input (a wastage %, a yarn price, a margin) directly in Excel and watch the final
 * price recalculate, exactly like the original "Price Working.xlsx". Returns the address of
 * the sheet's two headline outputs (Rate/Kg and Rate/Piece in the quote's currency) for the
 * summary sheet to reference.
 */
export interface ItemSheetResult {
  rateKgCell: string;
  ratePieceCell: string;
  gsmCell: string;
  qtyPerSetCell: string;
  qtyKgPerSetCell: string;
  marginPctCell: string;
  // Set only when ctx.containerFreightPerPiece was provided.
  freightPieceCell?: string;
}

export function writeItemSheet(ws: ExcelJS.Worksheet, ctx: ItemSheetContext): ItemSheetResult {
  const isYarnDyed = ctx.colorMethod === 'YARN_DYED';
  const isGarment = ctx.itemClass === 'GARMENT';

  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 14;
  ws.getColumn(4).width = 14;
  ws.getColumn(5).width = 20;
  ws.getColumn(6).width = 16;
  ws.getColumn(7).width = 22;

  let r = 1;
  const put = (row: number, col: number, value: ExcelJS.CellValue) => {
    const cell = ws.getCell(row, col);
    cell.value = value;
    return cell.address;
  };
  // Percentages are stored as true fractions (0.025 = 2.5%) everywhere except the yarn
  // mixing % column, which is already a raw 0-100 number - so it gets its own format that
  // just appends a "%" without Excel's usual x100 auto-scaling.
  const putPct = (row: number, col: number, value: ExcelJS.CellValue) => {
    const addr = put(row, col, value);
    ws.getCell(row, col).numFmt = '0.00%';
    return addr;
  };
  const putMoney = (row: number, col: number, value: ExcelJS.CellValue) => {
    const addr = put(row, col, value);
    ws.getCell(row, col).numFmt = '#,##0.0000';
    return addr;
  };

  ws.mergeCells(r, 1, r, 5);
  put(r, 1, `Set #${ctx.setNo} - ${ctx.segmentLabel} - ${ctx.itemTypeName}`);
  ws.getCell(r, 1).font = TITLE_FONT;
  r += 1;

  put(r, 1, 'Quote No');
  put(r, 2, ctx.quoteNo);
  put(r, 3, 'Customer');
  put(r, 4, ctx.customerName);
  r += 1;
  if (ctx.customerEnquiryNo) {
    put(r, 1, 'Customer Enquiry No');
    put(r, 2, ctx.customerEnquiryNo);
    r += 1;
  }
  put(r, 1, 'Color');
  put(r, 2, ctx.color);
  put(r, 3, 'Currency');
  put(r, 4, ctx.currency);
  r += 1;
  put(r, 1, 'Color method');
  put(r, 2, isYarnDyed ? 'Yarn dyed' : 'Piece dyed');
  put(r, 3, 'Item class');
  put(r, 4, isGarment ? 'Garment (fabric consumption)' : 'Flat (L x W)');
  r += 2;

  // --- Size & weight ---
  let pieceWeightCell: string;
  let gsmCell: string;
  if (isGarment) {
    put(r, 1, 'Fabric consumption (sqm/pc)');
    const fabricCell = put(r, 2, ctx.fabricConsumptionSqm);
    r++;
    put(r, 1, 'GSM');
    gsmCell = put(r, 2, ctx.gsm);
    r++;
    put(r, 1, 'Piece Weight (g)');
    pieceWeightCell = put(r, 2, { formula: `${fabricCell}*${gsmCell}` } as any);
    r++;
  } else {
    put(r, 1, 'Width (cm)');
    const widthCell = put(r, 2, ctx.widthCm);
    r++;
    put(r, 1, 'Length (cm)');
    const lengthCell = put(r, 2, ctx.lengthCm);
    r++;
    put(r, 1, 'GSM');
    gsmCell = put(r, 2, ctx.gsm);
    r++;
    put(r, 1, 'Piece Weight (g)');
    pieceWeightCell = put(r, 2, { formula: `${lengthCell}*${widthCell}*${gsmCell}/10000` } as any);
    r++;
  }
  put(r, 1, 'Qty / Set (pcs)');
  const qtyPerSetCell = put(r, 2, ctx.qtyPerSet);
  r++;
  put(r, 1, 'Qty (Kg) / Set');
  const qtyKgPerSetCell = put(r, 2, { formula: `${pieceWeightCell}*${qtyPerSetCell}/1000` } as any);
  r += 2;

  // --- Process parameters (waste/loss chain inputs) ---
  put(r, 1, 'PROCESS PARAMETERS');
  ws.getCell(r, 1).font = SECTION_FONT;
  r++;
  let yarnDyeingLossCell = '';
  if (isYarnDyed) {
    put(r, 1, 'Yarn dyeing process loss %');
    yarnDyeingLossCell = putPct(r, 2, ctx.yarnDyeingProcessLossPct);
    r++;
  }
  put(r, 1, 'Weaving wastage %');
  const weavingWastageCell = putPct(r, 2, ctx.weavingWastagePct);
  r++;
  put(r, 1, 'First velour loss %');
  const firstVelourLossCell = putPct(r, 2, ctx.firstVelourLossPct);
  r++;
  put(r, 1, isYarnDyed ? 'Washing loss %' : 'Weight loss %');
  const processingOrWashingLossCell = putPct(r, 2, isYarnDyed ? ctx.washingLossPct : ctx.weightLossPct);
  r++;
  put(r, 1, 'Second velour loss %');
  const secondVelourLossCell = putPct(r, 2, ctx.secondVelourLossPct);
  r++;
  put(r, 1, 'Rejection %');
  const rejectionCell = putPct(r, 2, ctx.rejectionPct);
  r++;
  let secondRejectionCell = '';
  if (isGarment) {
    put(r, 1, 'Second rejection %');
    secondRejectionCell = putPct(r, 2, ctx.secondRejectionPct);
    r++;
  }
  r += 1;

  // --- BOM waste-compounding multiplier chain ---
  put(r, 1, 'BOM MULTIPLIER CHAIN (how much input material is needed upstream to yield 1kg good output)');
  ws.getCell(r, 1).font = SECTION_FONT;
  r++;
  put(r, 1, 'Base (J2)');
  const j2Cell = put(r, 2, 1);
  r++;
  let baseCell = j2Cell;
  if (isYarnDyed) {
    put(r, 1, 'After yarn dyeing process loss (J2b)');
    baseCell = put(r, 2, { formula: `${j2Cell}/(1-${yarnDyeingLossCell})` } as any);
    r++;
  }
  put(r, 1, 'After weaving wastage (J3)');
  const j3Cell = put(r, 2, { formula: `${baseCell}/(1-${weavingWastageCell})` } as any);
  r++;
  put(r, 1, 'After first velour loss (J4)');
  const j4Cell = put(r, 2, { formula: `${j3Cell}/(1-${firstVelourLossCell})` } as any);
  r++;
  put(r, 1, isYarnDyed ? 'After washing loss (J5)' : 'After weight loss (J5)');
  const j5Cell = put(r, 2, { formula: `${j4Cell}/(1-${processingOrWashingLossCell})` } as any);
  r++;
  put(r, 1, 'After second velour loss (J6)');
  const j6Cell = put(r, 2, { formula: `${j5Cell}/(1-${secondVelourLossCell})` } as any);
  r++;
  put(r, 1, isGarment ? 'After rejection (J7)' : 'BOM Multiplier (J7, after rejection)');
  const j7Cell = put(r, 2, { formula: `${j6Cell}/(1-${rejectionCell})` } as any);
  if (!isGarment) ws.getCell(r, 2).font = LABEL_FONT;
  r++;
  let bomMultiplierCell = j7Cell;
  if (isGarment) {
    put(r, 1, 'BOM Multiplier (after second rejection)');
    bomMultiplierCell = put(r, 2, { formula: `${j7Cell}/(1-${secondRejectionCell})` } as any);
    ws.getCell(r, 2).font = LABEL_FONT;
    r++;
  }
  r += 1;

  // --- Running yield chain (G column) ---
  put(r, 1, 'YIELD CHAIN (running good-material yield after each stage)');
  ws.getCell(r, 1).font = SECTION_FONT;
  r++;
  put(r, 1, 'G8 (= BOM Multiplier)');
  const g8Cell = put(r, 2, { formula: `${bomMultiplierCell}` } as any);
  r++;
  let gAfterDyeingCell = g8Cell;
  if (isYarnDyed) {
    put(r, 1, 'G8b (after yarn dyeing process loss)');
    gAfterDyeingCell = put(r, 2, { formula: `${g8Cell}-${g8Cell}*${yarnDyeingLossCell}` } as any);
    r++;
  }
  put(r, 1, 'G9 (after weaving wastage)');
  const g9Cell = put(r, 2, { formula: `${gAfterDyeingCell}-${gAfterDyeingCell}*${weavingWastageCell}` } as any);
  r++;
  put(r, 1, 'G13 (after first velour loss)');
  const g13Cell = put(r, 2, { formula: `${g9Cell}-${g9Cell}*${firstVelourLossCell}` } as any);
  r++;
  put(r, 1, isYarnDyed ? 'G16 (after washing loss)' : 'G16 (after weight loss)');
  const g16Cell = put(r, 2, { formula: `${g13Cell}-${g13Cell}*${processingOrWashingLossCell}` } as any);
  r++;
  put(r, 1, 'G19 (after second velour loss)');
  const g19Cell = put(r, 2, { formula: `${g16Cell}-${g16Cell}*${secondVelourLossCell}` } as any);
  r++;
  put(r, 1, 'G23 (after rejection)');
  const g23Cell = put(r, 2, { formula: `${g19Cell}-${g19Cell}*${rejectionCell}` } as any);
  r += 2;

  // --- Yarn rates (BOM) ---
  put(r, 1, 'YARN RATES');
  ws.getCell(r, 1).font = SECTION_FONT;
  r++;
  const yarnHeaders = isYarnDyed
    ? ['Slot', 'Material', 'Mixing %', 'Price/Kg', 'Contribution (Rs/Kg)', 'Dyeing cost/Kg', 'Dyeing contribution (Rs/Kg)', 'Dye Variant']
    : ['Slot', 'Material', 'Mixing %', 'Price/Kg', 'Contribution (Rs/Kg)'];
  yarnHeaders.forEach((h, i) => {
    put(r, i + 1, h);
    ws.getCell(r, i + 1).font = LABEL_FONT;
  });
  r++;
  const yarnFirstRow = r;
  for (const y of ctx.yarnRows) {
    put(r, 1, y.slot);
    put(r, 2, y.overrideNote ? `${y.materialCode} (${y.overrideNote})` : y.materialCode);
    put(r, 3, y.mixingPct);
    ws.getCell(r, 3).numFmt = '0.00"%"';
    putMoney(r, 4, y.pricePerKg);
    putMoney(r, 5, { formula: `${bomMultiplierCell}*D${r}*C${r}/100` } as any);
    if (isYarnDyed) {
      putMoney(r, 6, y.dyeingCostPerKg ?? 0);
      putMoney(r, 7, { formula: `${bomMultiplierCell}*F${r}*C${r}/100` } as any);
      put(r, 8, y.dyeVariant || (y.dyeingCostPerKg ? '' : 'White / Undyed'));
    }
    r++;
  }
  const yarnLastRow = r - 1;
  put(r, 1, 'Mixing % total (should be 100)');
  put(r, 3, { formula: `SUM(C${yarnFirstRow}:C${yarnLastRow})` } as any);
  ws.getCell(r, 3).numFmt = '0.00"%"';
  r++;
  put(r, 1, 'Yarn cost / Kg');
  ws.getCell(r, 1).font = LABEL_FONT;
  const yarnCostCell = putMoney(r, 5, { formula: `SUM(E${yarnFirstRow}:E${yarnLastRow})` } as any);
  ws.getCell(r, 5).font = LABEL_FONT;
  r++;
  let dyeingCostCell: string | null = null;
  if (isYarnDyed) {
    put(r, 1, 'Dyeing cost / Kg');
    ws.getCell(r, 1).font = LABEL_FONT;
    dyeingCostCell = putMoney(r, 7, { formula: `SUM(G${yarnFirstRow}:G${yarnLastRow})` } as any);
    ws.getCell(r, 7).font = LABEL_FONT;
    r++;
  }
  r += 1;

  // --- Remaining process-cost inputs ---
  put(r, 1, 'Weaving + sizing cost / Kg');
  const weavingSizingCostCell = putMoney(r, 2, ctx.weavingSizingCostPerKg);
  r++;
  put(r, 1, 'First velour charges / Kg');
  const firstVelourChargesCell = putMoney(r, 2, ctx.firstVelourCharges);
  r++;
  put(r, 1, isYarnDyed ? 'Washing cost / Kg' : 'Processing charge / Kg (color)');
  const processingOrWashingRateCell = putMoney(r, 2, isYarnDyed ? ctx.washingCostPerKg : ctx.processingChargeRatePerKg);
  r++;
  put(r, 1, 'Second velour charges / Kg');
  const secondVelourChargesCell = putMoney(r, 2, ctx.secondVelourCharges);
  r++;
  put(r, 1, 'Local transport / Kg');
  const transportCell = putMoney(r, 2, ctx.transportLocalPerKg);
  r++;
  let stitchingCostCell = '';
  let stitchingPerPieceCell = '';
  if (isGarment) {
    put(r, 1, 'Stitching cost / Piece');
    stitchingPerPieceCell = putMoney(r, 2, ctx.stitchingCostPerPiece);
    r++;
  } else {
    put(r, 1, 'Stitching cost / Kg');
    stitchingCostCell = putMoney(r, 2, ctx.stitchingCostPerKg);
    r++;
  }
  put(r, 1, 'Packing cost / Kg');
  const packingCostCell = putMoney(r, 2, ctx.packingCostPerKg);
  r += 2;

  // --- Accessories & packaging charges ---
  put(r, 1, 'ACCESSORIES / PACKAGING (per piece)');
  ws.getCell(r, 1).font = SECTION_FONT;
  r++;
  put(r, 1, 'Description');
  put(r, 2, 'Cost / Piece');
  ws.getCell(r, 1).font = LABEL_FONT;
  ws.getCell(r, 2).font = LABEL_FONT;
  r++;
  const accFirstRow = r;
  if (ctx.accessoryRows.length === 0) {
    put(r, 1, '(none)');
    putMoney(r, 2, 0);
    r++;
  } else {
    for (const a of ctx.accessoryRows) {
      put(r, 1, a.name);
      putMoney(r, 2, a.costPerPiece);
      r++;
    }
  }
  const accLastRow = r - 1;
  put(r, 1, 'Accessories cost / piece');
  const accPerPieceCell = putMoney(r, 2, { formula: `SUM(B${accFirstRow}:B${accLastRow})` } as any);
  r++;
  put(r, 1, 'Accessories cost / Kg');
  const accessoriesPerKgCell = putMoney(r, 2, { formula: `IF(${pieceWeightCell}>0,(1000/${pieceWeightCell})*${accPerPieceCell},0)` } as any);
  r += 2;

  // --- Cost stack ---
  put(r, 1, 'COST STACK (per Kg, INR)');
  ws.getCell(r, 1).font = SECTION_FONT;
  r++;
  put(r, 1, 'Yarn cost');
  const f_yarn = putMoney(r, 2, { formula: `${yarnCostCell}` } as any);
  r++;
  let f_dyeing = '0';
  if (isYarnDyed && dyeingCostCell) {
    put(r, 1, 'Dyeing cost');
    f_dyeing = putMoney(r, 2, { formula: `${dyeingCostCell}` } as any);
    r++;
  }
  put(r, 1, 'Weaving + sizing cost (F10)');
  const f10 = putMoney(r, 2, { formula: `${g9Cell}*${weavingSizingCostCell}` } as any);
  r++;
  put(r, 1, 'First velour charges (F11)');
  const f11 = putMoney(r, 2, { formula: `${g9Cell}*${firstVelourChargesCell}` } as any);
  r++;
  put(r, 1, 'Subtotal after weaving (F12)');
  const f12 = putMoney(r, 2, { formula: `${f_yarn}+${f_dyeing}+${f10}+${f11}` } as any);
  r++;
  put(r, 1, isYarnDyed ? 'Washing charges (F14)' : 'Processing charges - color (F14)');
  const f14 = putMoney(r, 2, { formula: `${g13Cell}*${processingOrWashingRateCell}` } as any);
  r++;
  put(r, 1, 'Subtotal after processing (F15)');
  const f15 = putMoney(r, 2, { formula: `${f12}+${f14}` } as any);
  r++;
  put(r, 1, 'Second velour charges (F17)');
  const f17 = putMoney(r, 2, { formula: `${g16Cell}*${secondVelourChargesCell}` } as any);
  r++;
  put(r, 1, 'Subtotal after second velour (F18)');
  const f18 = putMoney(r, 2, { formula: `${f15}+${f17}` } as any);
  r++;
  put(r, 1, 'Local transport (F20)');
  const f20 = putMoney(r, 2, { formula: `${transportCell}*${g9Cell}` } as any);
  r++;
  put(r, 1, 'Stitching + packing + accessories (F21)');
  const stitchingTermFormula = isGarment
    ? `IF(${pieceWeightCell}>0,(1000/${pieceWeightCell})*${stitchingPerPieceCell},0)`
    : `${stitchingCostCell}`;
  const f21 = putMoney(r, 2, { formula: `${g19Cell}*((${stitchingTermFormula})+${packingCostCell}+${accessoriesPerKgCell})` } as any);
  r++;
  put(r, 1, 'Subtotal after stitching (F22)');
  const f22 = putMoney(r, 2, { formula: `${f18}+${f20}+${f21}` } as any);
  r += 2;

  // --- Freight / interest / margin / commission ---
  put(r, 1, 'W.C. Interest %');
  const wcCell = putPct(r, 2, ctx.wcInterestPct);
  r++;
  put(r, 1, 'Export freight / Kg');
  const freightCell = putMoney(r, 2, ctx.freightExportPerKg);
  r++;
  put(r, 1, 'LC Interest %');
  const lcCell = putPct(r, 2, ctx.lcInterestPct);
  r++;
  put(r, 1, 'Margin % (negative adds margin)');
  const marginCell = putPct(r, 2, ctx.marginPct);
  r++;

  // Duty Drawback / RoDTEP - internal profit metric only. These never feed into the
  // FINAL PRICE formula below; they only compute the effective margin row for reference.
  put(r, 1, `HSN Code (Duty Drawback)${ctx.hsnCode ? '' : ' - none selected'}`);
  put(r, 2, ctx.hsnCode ?? '-');
  r++;
  put(r, 1, 'DBK %');
  const dbkCell = putPct(r, 2, ctx.dbkPct);
  r++;
  put(r, 1, 'ROSCTL/RODEP %');
  const rosctlCell = putPct(r, 2, ctx.rosctlRodepPct);
  r++;
  put(r, 1, 'Margin % incl. DBK+ROSCTL/RODEP');
  ws.getCell(r, 1).font = LABEL_FONT;
  putPct(r, 2, { formula: `${marginCell}+${dbkCell}+${rosctlCell}` } as any);
  ws.getCell(r, 2).font = LABEL_FONT;
  r++;

  put(r, 1, 'Commission %');
  const commissionCell = putPct(r, 2, ctx.commissionPct);
  r += 1;

  put(r, 1, 'W.C. Interest, grossed up (F25)');
  const f25 = putMoney(r, 2, { formula: `${f22}/(1-${wcCell})-${f22}` } as any);
  r++;
  put(r, 1, 'Export freight (F26)');
  const f26 = putMoney(
    r,
    2,
    isGarment ? ({ formula: `${freightCell}` } as any) : ({ formula: `${freightCell}*${g23Cell}` } as any),
  );
  r++;
  put(r, 1, 'Subtotal after freight (F27)');
  const f27 = putMoney(r, 2, { formula: `${f22}+${f25}+${f26}` } as any);
  r++;
  put(r, 1, 'LC Interest, grossed up (F28)');
  const f28 = putMoney(r, 2, { formula: `${f27}/(1-${lcCell})-${f27}` } as any);
  r++;
  put(r, 1, 'Subtotal before margin (F29)');
  const f29 = putMoney(r, 2, { formula: `${f27}+${f28}` } as any);
  r++;
  put(r, 1, 'Margin (F30)');
  const f30 = putMoney(r, 2, { formula: `${f29}*${marginCell}` } as any);
  r++;
  put(r, 1, 'Subtotal after margin (F31)');
  const f31 = putMoney(r, 2, { formula: `${f29}+${f30}` } as any);
  r++;
  put(r, 1, 'Commission, grossed up (F32)');
  putMoney(r, 2, { formula: `${f31}/(1-${commissionCell})-${f31}` } as any);
  r += 2;

  put(r, 1, 'FINAL PRICE / KG (INR)');
  ws.getCell(r, 1).font = TITLE_FONT;
  const finalPriceInrCell = putMoney(r, 2, { formula: `${f29}/(1-(${marginCell}+${commissionCell}))` } as any);
  ws.getCell(r, 2).font = TITLE_FONT;
  r += 2;

  // --- Currency conversion ---
  put(r, 1, `Exchange rate (INR per 1 ${ctx.currency})`);
  const fxCell = putMoney(r, 2, ctx.exchangeRateToInr);
  r++;
  put(r, 1, `RATE / KG (${ctx.currency})`);
  ws.getCell(r, 1).font = TITLE_FONT;
  const rateKgCell = putMoney(
    r,
    2,
    ctx.currency === 'INR' ? ({ formula: `${finalPriceInrCell}` } as any) : ({ formula: `${finalPriceInrCell}/${fxCell}` } as any),
  );
  ws.getCell(r, 2).font = TITLE_FONT;
  r++;
  put(r, 1, `RATE / PIECE (${ctx.currency})`);
  ws.getCell(r, 1).font = TITLE_FONT;
  const ratePieceCell = putMoney(r, 2, { formula: `${rateKgCell}*${pieceWeightCell}/1000` } as any);
  ws.getCell(r, 2).font = TITLE_FONT;
  r++;

  let freightPieceCell: string | undefined;
  if (ctx.containerFreightPerPiece) {
    put(r, 1, `Container freight allocation / pc (${ctx.currency}) - CFR/CIF/Door Delivery`);
    freightPieceCell = putMoney(r, 2, ctx.containerFreightPerPiece);
  }

  const sheetRef = (addr: string) => `'${ws.name}'!${addr}`;
  return {
    rateKgCell: sheetRef(rateKgCell),
    ratePieceCell: sheetRef(ratePieceCell),
    gsmCell: sheetRef(gsmCell),
    qtyPerSetCell: sheetRef(qtyPerSetCell),
    qtyKgPerSetCell: sheetRef(qtyKgPerSetCell),
    marginPctCell: sheetRef(marginCell),
    freightPieceCell: freightPieceCell ? sheetRef(freightPieceCell) : undefined,
  };
}

/** Excel sheet names: max 31 chars, no : \ / ? * [ ] */
export function sanitizeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
}
