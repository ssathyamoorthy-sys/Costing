import { Fragment, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, openBinary, uploadFile } from '../api';
import type {
  CostingBreakup,
  HsnCode,
  ItemType,
  Product,
  ProcessingCharge,
  Quote,
  QuoteLine,
  QuoteRevision,
  QuoteTemplate,
  QuoteTemplateGroup,
  QuoteTemplateGroupSummary,
  QuoteTemplateSummary,
  RawMaterial,
} from '../types';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/Alert';

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€' };

function statusBadgeClass(status: string) {
  switch (status) {
    case 'DRAFT':
      return 'draft';
    case 'PENDING_APPROVAL':
      return 'pending';
    case 'APPROVED':
    case 'CONVERTED_TO_ORDER':
      return 'approved';
    case 'REJECTED':
    case 'LOST_PRICE':
    case 'LOST_MOQ':
    case 'LOST_LEAD_TIME':
      return 'rejected';
    case 'SENT':
      return 'sent';
    default:
      return 'draft';
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'CONVERTED_TO_ORDER':
      return 'Converted to Order';
    case 'LOST_PRICE':
      return 'Lost - Price';
    case 'LOST_MOQ':
      return 'Lost - MOQ';
    case 'LOST_LEAD_TIME':
      return 'Lost - Lead Time';
    default:
      return status.replace(/_/g, ' ');
  }
}

const breakupRows: { key: keyof CostingBreakup; label: string }[] = [
  { key: 'yarnCostPerKg', label: 'Yarn cost (BOM, waste-adjusted)' },
  { key: 'weavingSizingCostPerKg', label: 'Weaving + sizing cost' },
  { key: 'firstVelourChargesPerKg', label: 'First velour charges' },
  { key: 'processingChargesPerKg', label: 'Processing charges (color)' },
  { key: 'secondVelourChargesPerKg', label: 'Second velour charges' },
  { key: 'transportLocalPerKg', label: 'Local transport' },
  { key: 'stitchingPackingPerKg', label: 'Stitching + packing + accessories' },
  { key: 'wcInterestPerKg', label: 'W.C. Interest (grossed up)' },
  { key: 'freightExportPerKg', label: 'Export freight' },
  { key: 'lcInterestPerKg', label: 'LC Interest (grossed up)' },
  { key: 'subtotalBeforeMargin', label: 'Subtotal before margin/commission' },
  { key: 'marginPerKg', label: 'Margin' },
  { key: 'commissionPerKg', label: 'Commission (grossed up)' },
  { key: 'finalPricePerKgInr', label: 'Final price / kg (INR)' },
];

interface FormYarnRow {
  slot: string;
  rawMaterialId: number | '';
  mixingPct: number;
  dyeingCostPerKg: number;
}
interface FormPackagingCharge {
  description: string;
  ratePerPiece: string;
}
interface FormItem {
  itemTypeId: number | '';
  lengthCm: string;
  widthCm: string;
  fabricConsumptionSqm: string;
  gsm: string;
  qtyPerSet: string;
  hsnCodeId: number | '';
  packagingCharges: FormPackagingCharge[];
}
interface FormSegment {
  productId: number | '';
  yarnComponents: FormYarnRow[];
  items: FormItem[];
}
interface SetForm {
  color: string;
  qtySets: string;
  targetPrice: string;
  segments: FormSegment[];
}

function emptyItem(): FormItem {
  return { itemTypeId: '', lengthCm: '', widthCm: '', fabricConsumptionSqm: '', gsm: '', qtyPerSet: '1', hsnCodeId: '', packagingCharges: [] };
}
// Garment items (fabricConsumptionSqm set, lengthCm/widthCm left at the 0 sentinel) show
// the fabric consumption instead of a meaningless "0x0cm".
function sizeLabel(item: { lengthCm: number; widthCm: number; fabricConsumptionSqm?: number | null }) {
  return item.fabricConsumptionSqm ? `${item.fabricConsumptionSqm} sqm fabric` : `${item.lengthCm}x${item.widthCm}cm`;
}
// The Pile slot carries the towel's loop/terry yarn - the single most commercially relevant
// yarn code to a merchandiser at a glance, so it's surfaced outside the Supervisor-only
// "Yarn recipe" breakdown table.
function pileYarnCode(seg: { yarnComponents: { slot: string; rawMaterial?: { code: string } | null }[] }) {
  return seg.yarnComponents.find((c) => c.slot.trim().toLowerCase() === 'pile')?.rawMaterial?.code ?? null;
}
// "Single Product" means truly one simple piece per set (1 segment, 1 item type, 1 pc/set).
// A single item type with qtyPerSet > 1 (e.g. a 4-pack sold as one set) is still a
// bundle-style quantity structure - it needs its own Qty/Set field, not a flattened "N pcs"
// that silently drops the per-set count.
function isSingleLine(segments: { items: { qtyPerSet: number }[] }[]): boolean {
  return segments.length === 1 && segments[0].items.length === 1 && segments[0].items[0].qtyPerSet === 1;
}
function emptySegment(): FormSegment {
  return { productId: '', yarnComponents: [], items: [emptyItem()] };
}
function emptySetForm(): SetForm {
  return { color: '', qtySets: '1', targetPrice: '', segments: [emptySegment()] };
}

export function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [revisions, setRevisions] = useState<QuoteRevision[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [hsnCodes, setHsnCodes] = useState<HsnCode[]>([]);
  const [colors, setColors] = useState<ProcessingCharge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [showForm, setShowForm] = useState(false);
  const [editingLineId, setEditingLineId] = useState<number | null>(null);
  const [form, setForm] = useState<SetForm>(emptySetForm());
  const [mode, setMode] = useState<'single' | 'bundle'>('single');
  const [showYarnEditorSingle, setShowYarnEditorSingle] = useState(false);
  const [templates, setTemplates] = useState<QuoteTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateGroups, setTemplateGroups] = useState<QuoteTemplateGroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [applyingGroup, setApplyingGroup] = useState(false);

  const [overrideForSegment, setOverrideForSegment] = useState<number | null>(null);
  const [overrideMaterialId, setOverrideMaterialId] = useState<number | ''>('');
  const [overridePrice, setOverridePrice] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const [editMarginForLine, setEditMarginForLine] = useState<number | null>(null);
  const [marginInputPct, setMarginInputPct] = useState('');

  const [showTermsEditor, setShowTermsEditor] = useState(false);
  const [termsForm, setTermsForm] = useState({ marginPct: '', commissionPct: '', wcInterestPct: '', lcInterestPct: '' });

  const [editingEnquiryNo, setEditingEnquiryNo] = useState(false);
  const [enquiryNoInput, setEnquiryNoInput] = useState('');

  function load() {
    api
      .get<Quote>(`/quotes/${id}`)
      .then(setQuote)
      .catch((e) => setError(e.message));
    api
      .get<QuoteRevision[]>(`/quotes/${id}/revisions`)
      .then(setRevisions)
      .catch(() => {});
  }
  useEffect(load, [id]);
  useEffect(() => {
    api.get<Product[]>('/products').then(setProducts);
    api.get<ItemType[]>('/item-types').then(setItemTypes);
    api.get<RawMaterial[]>('/raw-materials').then(setRawMaterials);
    api.get<ProcessingCharge[]>('/processing-charges').then(setColors);
    api.get<HsnCode[]>('/hsn-codes').then(setHsnCodes);
  }, []);
  useEffect(() => {
    if (!quote) return;
    api.get<QuoteTemplateSummary[]>(`/quote-templates?customerId=${quote.customerId}`).then(setTemplates);
    api.get<QuoteTemplateGroupSummary[]>(`/quote-template-groups?customerId=${quote.customerId}`).then(setTemplateGroups);
  }, [quote?.customerId]);

  if (!quote) return error ? <Alert type="error">{error}</Alert> : <p className="muted">Loading...</p>;

  const isOwner = quote.createdById === user?.id;
  const isMerchandiser = user?.role === 'MERCHANDISER' || user?.role === 'ADMIN';
  const isSupervisor = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const isAdmin = user?.role === 'ADMIN';
  // Once locked, pricing is irrevocable for everyone except Admin/Supervisor (emergency
  // escape hatch) - every price-mutating button in this page is gated on this, matching
  // assertNotLocked on the backend.
  const pricingLocked = quote.locked && !isAdmin && !isSupervisor;
  // Supervisor can keep negotiating (yarn/margin overrides, line edits) through APPROVED and
  // SENT - that's the whole point of a negotiation round - right up until the quote is locked.
  const canEditLines =
    !pricingLocked &&
    ((quote.status === 'DRAFT' && isOwner && isMerchandiser) ||
      (isSupervisor && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(quote.status)));
  const currency = quote.currency;
  const symbol = CURRENCY_SYMBOL[currency] || '';

  // --- Set builder form helpers ---

  function startNewSet() {
    setEditingLineId(null);
    setForm(emptySetForm());
    setMode('single');
    setShowYarnEditorSingle(false);
    setSelectedTemplateId('');
    setShowForm(true);
  }

  function startEditSet(line: QuoteLine) {
    setEditingLineId(line.id);
    setForm({
      color: line.color,
      qtySets: String(line.qtySets),
      targetPrice: line.targetPrice != null ? String(line.targetPrice) : '',
      segments: line.segments.map((seg) => ({
        productId: seg.productId,
        yarnComponents: seg.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: y.rawMaterialId, mixingPct: y.mixingPct, dyeingCostPerKg: y.dyeingCostPerKg ?? 0 })),
        items: seg.items.map((it) => ({
          itemTypeId: it.itemTypeId,
          lengthCm: String(it.lengthCm),
          widthCm: String(it.widthCm),
          fabricConsumptionSqm: it.fabricConsumptionSqm ? String(it.fabricConsumptionSqm) : '',
          gsm: String(it.gsm),
          qtyPerSet: String(it.qtyPerSet),
          hsnCodeId: it.hsnCodeId ?? '',
          packagingCharges: it.packagingCharges.map((p) => ({ description: p.description, ratePerPiece: String(p.ratePerPiece) })),
        })),
      })),
    });
    setMode(isSingleLine(line.segments) ? 'single' : 'bundle');
    setShowYarnEditorSingle(false);
    setSelectedTemplateId('');
    setShowForm(true);
  }

  // Deliberately structural only (not qtyPerSet) - toSingleMode() below already knows how to
  // merge a qtyPerSet > 1 single item into a flat piece count, so that manual conversion
  // stays available even when the line isn't already "single" shaped.
  function canUseSingleMode(f: SetForm) {
    return f.segments.length === 1 && f.segments[0].items.length === 1;
  }
  function toSingleMode() {
    setForm((f) => {
      const totalQty = Math.round(Number(f.qtySets || 1) * Number(f.segments[0].items[0].qtyPerSet || 1));
      return {
        ...f,
        qtySets: String(totalQty),
        segments: [{ ...f.segments[0], items: [{ ...f.segments[0].items[0], qtyPerSet: '1' }] }],
      };
    });
    setMode('single');
  }

  async function loadTemplate(templateId: number) {
    setSelectedTemplateId(String(templateId));
    const template = await api.get<QuoteTemplate>(`/quote-templates/${templateId}`);
    setForm({
      color: template.color,
      qtySets: String(template.qtySets),
      targetPrice: '',
      segments: template.segments.map((seg) => ({
        productId: seg.productId,
        yarnComponents: seg.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: y.rawMaterialId, mixingPct: y.mixingPct, dyeingCostPerKg: y.dyeingCostPerKg ?? 0 })),
        items: seg.items.map((it) => ({
          itemTypeId: it.itemTypeId,
          lengthCm: String(it.lengthCm),
          widthCm: String(it.widthCm),
          fabricConsumptionSqm: it.fabricConsumptionSqm ? String(it.fabricConsumptionSqm) : '',
          gsm: String(it.gsm),
          qtyPerSet: String(it.qtyPerSet),
          hsnCodeId: '' as number | '',
          packagingCharges: it.packagingCharges.map((p) => ({ description: p.description, ratePerPiece: String(p.ratePerPiece) })),
        })),
      })),
    });
    setMode(isSingleLine(template.segments) ? 'single' : 'bundle');
    setShowYarnEditorSingle(false);
  }

  async function saveLineAsTemplate(lineId: number) {
    const name = prompt('Name this template (e.g. "Greenline Standard Gift Set"):');
    if (!name) return;
    try {
      await api.post(`/quotes/${quote!.id}/lines/${lineId}/save-as-template`, { name });
      const list = await api.get<QuoteTemplateSummary[]>(`/quote-templates?customerId=${quote!.customerId}`);
      setTemplates(list);
      alert(`Saved as template "${name}". It'll show up under "Load from template" next time you quote this customer.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.existingTemplateId) {
        const overwrite = confirm(`${e.body.error}. Overwrite it with this set's current recipe?`);
        if (overwrite) {
          try {
            await api.post(`/quotes/${quote!.id}/lines/${lineId}/save-as-template`, { name, overwrite: true });
            const list = await api.get<QuoteTemplateSummary[]>(`/quote-templates?customerId=${quote!.customerId}`);
            setTemplates(list);
            alert(`Updated template "${name}" with this set's current recipe.`);
          } catch (e2) {
            setError(e2 instanceof ApiError ? e2.message : String(e2));
          }
        }
        return;
      }
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function saveQuoteAsTemplateGroup() {
    const name = prompt('Name this whole-quote recipe (e.g. "Greenline Monthly Order"):');
    if (!name) return;
    try {
      await api.post(`/quotes/${quote!.id}/save-as-template-group`, { name });
      const list = await api.get<QuoteTemplateGroupSummary[]>(`/quote-template-groups?customerId=${quote!.customerId}`);
      setTemplateGroups(list);
      alert(`Saved as recipe "${name}" (${quote!.lines.length} set(s)). It'll show up under "Apply saved recipe" next time you quote this customer.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.existingGroupId) {
        const overwrite = confirm(`${e.body.error}. Overwrite it with this quote's current sets?`);
        if (overwrite) {
          try {
            await api.post(`/quotes/${quote!.id}/save-as-template-group`, { name, overwrite: true });
            const list = await api.get<QuoteTemplateGroupSummary[]>(`/quote-template-groups?customerId=${quote!.customerId}`);
            setTemplateGroups(list);
            alert(`Updated recipe "${name}" with this quote's current ${quote!.lines.length} set(s).`);
          } catch (e2) {
            setError(e2 instanceof ApiError ? e2.message : String(e2));
          }
        }
        return;
      }
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  // Re-creates every Set from a saved whole-quote recipe in one go, reusing the same
  // per-line create endpoint used everywhere else - each Set is priced fresh off today's
  // rates, and the result is a normal editable QuoteLine (add/remove items works as usual).
  async function applyTemplateGroup(groupId: number) {
    setSelectedGroupId(String(groupId));
    setApplyingGroup(true);
    setError(null);
    try {
      const group = await api.get<QuoteTemplateGroup>(`/quote-template-groups/${groupId}`);
      const allWarnings: string[] = [];
      for (const template of group.templates) {
        const payload = {
          color: template.color,
          qtySets: template.qtySets,
          segments: template.segments.map((seg) => ({
            productId: seg.productId,
            yarnComponents: seg.yarnComponents.map((y) => ({ slot: y.slot, rawMaterialId: y.rawMaterialId, mixingPct: y.mixingPct, dyeingCostPerKg: y.dyeingCostPerKg ?? 0 })),
            items: seg.items.map((it) => ({
              itemTypeId: it.itemTypeId,
              lengthCm: it.lengthCm,
              widthCm: it.widthCm,
              fabricConsumptionSqm: it.fabricConsumptionSqm ?? undefined,
              gsm: it.gsm,
              qtyPerSet: it.qtyPerSet,
              packagingCharges: it.packagingCharges.map((p) => ({ description: p.description, ratePerPiece: p.ratePerPiece })),
            })),
          })),
        };
        const res = await api.post<{ line: QuoteLine; warnings: string[] }>(`/quotes/${quote!.id}/lines`, payload);
        allWarnings.push(...res.warnings);
      }
      setWarnings(allWarnings);
      setSelectedGroupId('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setApplyingGroup(false);
    }
  }

  function cancelForm() {
    setShowForm(false);
    setEditingLineId(null);
  }

  function addSegment() {
    setForm((f) => ({ ...f, segments: [...f.segments, emptySegment()] }));
  }
  function removeSegment(segIdx: number) {
    setForm((f) => ({ ...f, segments: f.segments.filter((_, i) => i !== segIdx) }));
  }
  function setSegmentProduct(segIdx: number, productId: number) {
    const product = products.find((p) => p.id === productId);
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) =>
        i === segIdx
          ? {
              ...seg,
              productId,
              yarnComponents: (product?.yarnComponents ?? []).map((c) => ({
                slot: c.slot,
                rawMaterialId: c.rawMaterialId,
                mixingPct: c.mixingPct,
                dyeingCostPerKg: c.dyeingCostPerKg ?? 0,
              })),
            }
          : seg,
      ),
    }));
  }
  function addYarnRow(segIdx: number) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, yarnComponents: [...seg.yarnComponents, { slot: '', rawMaterialId: '', mixingPct: 0, dyeingCostPerKg: 0 }] } : seg)),
    }));
  }
  function updateYarnRow(segIdx: number, rowIdx: number, patch: Partial<FormYarnRow>) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) =>
        i === segIdx ? { ...seg, yarnComponents: seg.yarnComponents.map((r, ri) => (ri === rowIdx ? { ...r, ...patch } : r)) } : seg,
      ),
    }));
  }
  function removeYarnRow(segIdx: number, rowIdx: number) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, yarnComponents: seg.yarnComponents.filter((_, ri) => ri !== rowIdx) } : seg)),
    }));
  }
  function addItem(segIdx: number) {
    setForm((f) => ({ ...f, segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, items: [...seg.items, emptyItem()] } : seg)) }));
  }
  function removeItem(segIdx: number, itemIdx: number) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) => (i === segIdx ? { ...seg, items: seg.items.filter((_, ii) => ii !== itemIdx) } : seg)),
    }));
  }
  function updateItem(segIdx: number, itemIdx: number, patch: Partial<FormItem>) {
    setForm((f) => ({
      ...f,
      segments: f.segments.map((seg, i) =>
        i === segIdx ? { ...seg, items: seg.items.map((it, ii) => (ii === itemIdx ? { ...it, ...patch } : it)) } : seg,
      ),
    }));
  }
  function addPackagingCharge(segIdx: number, itemIdx: number) {
    updateItem(segIdx, itemIdx, {
      packagingCharges: [...form.segments[segIdx].items[itemIdx].packagingCharges, { description: '', ratePerPiece: '' }],
    });
  }
  function updatePackagingCharge(segIdx: number, itemIdx: number, chargeIdx: number, patch: Partial<FormPackagingCharge>) {
    const item = form.segments[segIdx].items[itemIdx];
    updateItem(segIdx, itemIdx, {
      packagingCharges: item.packagingCharges.map((c, ci) => (ci === chargeIdx ? { ...c, ...patch } : c)),
    });
  }
  function removePackagingCharge(segIdx: number, itemIdx: number, chargeIdx: number) {
    const item = form.segments[segIdx].items[itemIdx];
    updateItem(segIdx, itemIdx, { packagingCharges: item.packagingCharges.filter((_, ci) => ci !== chargeIdx) });
  }

  function formIsValid() {
    if (!form.color || !form.qtySets) return false;
    for (const seg of form.segments) {
      if (!seg.productId || seg.yarnComponents.length === 0) return false;
      for (const y of seg.yarnComponents) {
        if (!y.rawMaterialId) return false;
      }
      if (seg.items.length === 0) return false;
      for (const it of seg.items) {
        if (!it.itemTypeId || !it.gsm || !it.qtyPerSet) return false;
        const isGarment = itemTypes.find((t) => t.id === it.itemTypeId)?.sizingMethod === 'FABRIC_CONSUMPTION';
        if (isGarment ? !it.fabricConsumptionSqm : !it.lengthCm || !it.widthCm) return false;
      }
    }
    return true;
  }

  function buildPayload() {
    return {
      color: form.color,
      qtySets: Number(form.qtySets),
      targetPrice: form.targetPrice ? Number(form.targetPrice) : undefined,
      segments: form.segments.map((seg) => ({
        productId: Number(seg.productId),
        yarnComponents: seg.yarnComponents.map((y) => ({
          slot: y.slot,
          rawMaterialId: Number(y.rawMaterialId),
          mixingPct: Number(y.mixingPct),
          dyeingCostPerKg: Number(y.dyeingCostPerKg) || 0,
        })),
        items: seg.items.map((it) => {
          const isGarment = itemTypes.find((t) => t.id === it.itemTypeId)?.sizingMethod === 'FABRIC_CONSUMPTION';
          return {
            itemTypeId: Number(it.itemTypeId),
            lengthCm: isGarment ? 0 : Number(it.lengthCm),
            widthCm: isGarment ? 0 : Number(it.widthCm),
            fabricConsumptionSqm: isGarment ? Number(it.fabricConsumptionSqm) : undefined,
            gsm: Number(it.gsm),
            qtyPerSet: Number(it.qtyPerSet),
            hsnCodeId: it.hsnCodeId ? Number(it.hsnCodeId) : undefined,
            packagingCharges: it.packagingCharges
              .filter((p) => p.description && p.ratePerPiece)
              .map((p) => ({ description: p.description, ratePerPiece: Number(p.ratePerPiece) })),
          };
        }),
      })),
    };
  }

  async function submitSet() {
    setError(null);
    try {
      const payload = buildPayload();
      const res = editingLineId
        ? await api.put<{ line: QuoteLine; warnings: string[] }>(`/quotes/${quote!.id}/lines/${editingLineId}`, payload)
        : await api.post<{ line: QuoteLine; warnings: string[] }>(`/quotes/${quote!.id}/lines`, payload);
      setWarnings(res.warnings);
      setShowForm(false);
      setEditingLineId(null);
      setForm(emptySetForm());
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function removeLine(lineId: number) {
    if (!confirm('Remove this set?')) return;
    try {
      await api.del(`/quotes/${quote!.id}/lines/${lineId}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function submitQuote() {
    try {
      await api.post(`/quotes/${quote!.id}/submit`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function approveQuote() {
    try {
      await api.post(`/quotes/${quote!.id}/approve`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function rejectQuote() {
    const remarks = prompt('Reason for rejecting this quote:') || undefined;
    try {
      await api.post(`/quotes/${quote!.id}/reject`, { remarks });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function markSent() {
    try {
      await api.post(`/quotes/${quote!.id}/mark-sent`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function setEnquiryStatus(status: 'CONVERTED_TO_ORDER' | 'LOST_PRICE' | 'LOST_MOQ' | 'LOST_LEAD_TIME') {
    try {
      await api.post(`/quotes/${quote!.id}/status`, { status });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }
  async function deleteQuote() {
    if (!confirm(`Delete quote ${quote!.quoteNo}? This cannot be undone.`)) return;
    try {
      await api.del(`/quotes/${quote!.id}`);
      navigate('/quotes');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function lockQuote() {
    if (
      !confirm(
        'Lock & Finalize this quote? A permanent Cost Verification Number (CVN) will be generated, and pricing can never be changed again (only an Admin could still touch it). This cannot be undone.',
      )
    )
      return;
    try {
      await api.post(`/quotes/${quote!.id}/lock`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function matchTargetPrice(lineId: number) {
    try {
      await api.post(`/quotes/${quote!.id}/lines/${lineId}/match-target-price`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function clearLineMarginOverride(lineId: number) {
    try {
      await api.post(`/quotes/${quote!.id}/lines/${lineId}/clear-margin-override`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function handleCostSheetUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setImportMessage(null);
    setError(null);
    try {
      const result = await uploadFile<{
        changed: boolean;
        materialsUpdated?: number;
        marginsUpdated?: number;
        commercialTermsUpdated?: string[];
        warnings: string[];
      }>(`/quotes/${quote!.id}/import-costsheet`, file);

      if (result.changed) {
        const parts: string[] = [];
        if (result.materialsUpdated) parts.push(`${result.materialsUpdated} yarn price(s)`);
        if (result.marginsUpdated) parts.push(`${result.marginsUpdated} set margin(s)`);
        if (result.commercialTermsUpdated?.length) parts.push(`commercial terms (${result.commercialTermsUpdated.join(', ')})`);
        setImportMessage(`Updated from cost sheet: ${parts.join(', ') || 'quote recalculated'}.`);
      } else {
        setImportMessage("Nothing changed - the file matched what's already on the quote.");
      }
      setWarnings(result.warnings || []);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  async function applyLineMarginOverride(lineId: number) {
    if (marginInputPct === '') return;
    try {
      await api.post(`/quotes/${quote!.id}/lines/${lineId}/margin-override`, { marginPctOverride: Number(marginInputPct) / 100 });
      setEditMarginForLine(null);
      setMarginInputPct('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function submitOverride(segmentId: number) {
    if (!overrideMaterialId || !overridePrice) return;
    try {
      await api.post(`/quotes/${quote!.id}/segments/${segmentId}/material-override`, {
        rawMaterialId: overrideMaterialId,
        overridePricePerKg: Number(overridePrice),
        reason: overrideReason || undefined,
      });
      setOverrideForSegment(null);
      setOverrideMaterialId('');
      setOverridePrice('');
      setOverrideReason('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function openTermsEditor() {
    setTermsForm({
      marginPct: quote!.marginPctOverride != null ? String(quote!.marginPctOverride * 100) : '',
      commissionPct: quote!.commissionPctOverride != null ? String(quote!.commissionPctOverride * 100) : '',
      wcInterestPct: quote!.wcInterestPctOverride != null ? String(quote!.wcInterestPctOverride * 100) : '',
      lcInterestPct: quote!.lcInterestPctOverride != null ? String(quote!.lcInterestPctOverride * 100) : '',
    });
    setShowTermsEditor(true);
  }

  async function saveTermsOverride() {
    try {
      await api.post(`/quotes/${quote!.id}/terms-override`, {
        marginPctOverride: termsForm.marginPct === '' ? null : Number(termsForm.marginPct) / 100,
        commissionPctOverride: termsForm.commissionPct === '' ? null : Number(termsForm.commissionPct) / 100,
        wcInterestPctOverride: termsForm.wcInterestPct === '' ? null : Number(termsForm.wcInterestPct) / 100,
        lcInterestPctOverride: termsForm.lcInterestPct === '' ? null : Number(termsForm.lcInterestPct) / 100,
      });
      setShowTermsEditor(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function clearTermsOverride() {
    try {
      await api.post(`/quotes/${quote!.id}/terms-override`, {
        marginPctOverride: null,
        commissionPctOverride: null,
        wcInterestPctOverride: null,
        lcInterestPctOverride: null,
      });
      setShowTermsEditor(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function openEnquiryNoEditor() {
    setEnquiryNoInput(quote!.customerEnquiryNo || '');
    setEditingEnquiryNo(true);
  }

  async function saveEnquiryNo() {
    try {
      await api.put(`/quotes/${quote!.id}/details`, { customerEnquiryNo: enquiryNoInput || null });
      setEditingEnquiryNo(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function segmentMixingTotal(seg: FormSegment) {
    return seg.yarnComponents.reduce((s, r) => s + (Number(r.mixingPct) || 0), 0);
  }

  // Revenue-weighted blended margin across every set in the quote - lets a supervisor see
  // the whole enquiry's profitability at a glance, not just one set at a time (e.g. right
  // after "Match to target price" moves one set's margin without changing the others).
  function consolidatedMargin(): { totalRevenue: number; totalMargin: number; blendedPct: number } | null {
    let totalRevenue = 0;
    let totalMargin = 0;
    let anyPriced = false;
    for (const line of quote!.lines) {
      const rollup: { ratePerSet?: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
      const revenue = (rollup?.ratePerSet?.[currency] ?? 0) * line.qtySets;
      let marginPct: number | null = null;
      outer: for (const seg of line.segments) {
        for (const item of seg.items) {
          if (!item.costBreakupJson) continue;
          const b: CostingBreakup = JSON.parse(item.costBreakupJson);
          if (b.marginPct != null) {
            marginPct = b.marginPct;
            break outer;
          }
        }
      }
      if (marginPct != null && revenue > 0) {
        anyPriced = true;
        totalRevenue += revenue;
        totalMargin += revenue * marginPct;
      }
    }
    if (!anyPriced) return null;
    return { totalRevenue, totalMargin, blendedPct: totalRevenue > 0 ? totalMargin / totalRevenue : 0 };
  }

  return (
    <div>
      <div className="toolbar">
        <div>
          <h2 style={{ marginBottom: 4 }}>
            Quote {quote.quoteNo} <span className={`badge ${statusBadgeClass(quote.status)}`}>{statusLabel(quote.status)}</span>
          </h2>
          {editingEnquiryNo ? (
            <div className="tag-row" style={{ marginBottom: 8 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Customer enquiry no.
              </span>
              <input
                value={enquiryNoInput}
                onChange={(e) => setEnquiryNoInput(e.target.value)}
                placeholder="their RFQ / reference number"
                style={{ width: 220 }}
              />
              <button className="btn small primary" onClick={saveEnquiryNo}>
                Save
              </button>
              <button className="btn small" onClick={() => setEditingEnquiryNo(false)}>
                Cancel
              </button>
            </div>
          ) : (
            ((quote.status === 'DRAFT' && isOwner && isMerchandiser) || isSupervisor) && (
              <p className="muted" style={{ marginTop: 0, marginBottom: 8, fontSize: 13 }}>
                Customer enquiry no.: {quote.customerEnquiryNo || <em>not set</em>}{' '}
                <button className="btn small" onClick={openEnquiryNoEditor} style={{ marginLeft: 6 }}>
                  Edit
                </button>
              </p>
            )
          )}
          {!editingEnquiryNo && !((quote.status === 'DRAFT' && isOwner && isMerchandiser) || isSupervisor) && quote.customerEnquiryNo && (
            <p className="muted" style={{ marginTop: 0, marginBottom: 8, fontSize: 13 }}>
              Customer enquiry no.: {quote.customerEnquiryNo}
            </p>
          )}
        </div>
        <div className="tag-row">
          {quote.status === 'DRAFT' && isOwner && (isMerchandiser || isSupervisor) && quote.lines.length > 0 && (
            <button className="btn primary" onClick={submitQuote}>
              Submit for approval
            </button>
          )}
          {quote.status === 'PENDING_APPROVAL' && isSupervisor && (
            <>
              <button className="btn success" onClick={approveQuote}>
                Approve
              </button>
              <button className="btn danger" onClick={rejectQuote}>
                Reject
              </button>
            </>
          )}
          {quote.status === 'APPROVED' && (
            <button className="btn primary" onClick={markSent}>
              Mark as sent to customer
            </button>
          )}
          {isSupervisor && (quote.status === 'SENT' || quote.status === 'CONVERTED_TO_ORDER') && !quote.locked && (
            <button className="btn primary" onClick={lockQuote} title="Generates a permanent Cost Verification Number (CVN) and freezes pricing for good">
              Lock &amp; Finalize
            </button>
          )}
          {quote.status === 'SENT' && (isOwner || isSupervisor) && (
            <>
              <button className="btn success" onClick={() => setEnquiryStatus('CONVERTED_TO_ORDER')}>
                Converted to Order
              </button>
              <button className="btn danger" onClick={() => setEnquiryStatus('LOST_PRICE')}>
                Lost - Price
              </button>
              <button className="btn danger" onClick={() => setEnquiryStatus('LOST_MOQ')}>
                Lost - MOQ
              </button>
              <button className="btn danger" onClick={() => setEnquiryStatus('LOST_LEAD_TIME')}>
                Lost - Lead Time
              </button>
            </>
          )}
          <button className="btn" onClick={() => openBinary(`/quotes/${quote.id}/pdf`, `${quote.quoteNo}.pdf`)}>
            Download PDF
          </button>
          <button className="btn" onClick={() => openBinary(`/quotes/${quote.id}/xlsx`, `${quote.quoteNo}.xlsx`)}>
            Download Excel
          </button>
          {isSupervisor && (
            <button
              className="btn"
              onClick={() => openBinary(`/quotes/${quote.id}/xlsx-detailed`, `${quote.quoteNo}-detailed.xlsx`)}
              title="Full cost build-up as live Excel formulas, one sheet per item"
            >
              Download Excel (with formulas)
            </button>
          )}
          {isSupervisor && !pricingLocked && (
            <label className={`btn${importing ? ' disabled' : ''}`} style={{ cursor: importing ? 'default' : 'pointer' }}>
              {importing ? 'Uploading...' : 'Upload revised cost sheet'}
              <input type="file" accept=".xlsx" onChange={handleCostSheetUpload} disabled={importing} style={{ display: 'none' }} />
            </label>
          )}
          {canEditLines && quote.lines.length > 0 && (
            <button className="btn" onClick={saveQuoteAsTemplateGroup} title="Save every set in this quote as one named, reusable recipe">
              Save quote as template
            </button>
          )}
          <button className="btn" onClick={() => navigate('/quotes')}>
            Back to list
          </button>
          {isSupervisor && (
            <button className="btn danger" onClick={deleteQuote}>
              Delete quote
            </button>
          )}
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}
      {importMessage && <Alert type="success">{importMessage}</Alert>}
      {warnings.map((w, i) => (
        <Alert key={i} type="warning">
          {w}
        </Alert>
      ))}
      {quote.remarks && <Alert type={quote.status === 'REJECTED' ? 'error' : 'success'}>Remarks: {quote.remarks}</Alert>}

      {quote.locked && (
        <div className="panel" style={{ background: 'var(--blue-light)', borderColor: 'var(--blue)' }}>
          <strong>Locked &amp; Finalized</strong> - pricing is irrevocable.
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Cost Verification Number (CVN)
              </div>
              <strong>{quote.finalReferenceNo}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Locked by
              </div>
              {quote.lockedBy?.name ?? '-'}
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Locked at
              </div>
              {quote.lockedAt ? new Date(quote.lockedAt).toLocaleString() : '-'}
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="form-grid">
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Customer
            </div>
            <strong>{quote.customer?.name}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Payment Terms
            </div>
            {quote.paymentTerms || '-'}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Freight Terms
            </div>
            {quote.freightTerms || '-'}
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Created by
            </div>
            {quote.createdBy?.name}
          </div>
        </div>
      </div>

      {revisions.length > 0 && (
        <div className="panel">
          <strong>Negotiation / revision history</strong>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            A snapshot of the price is saved automatically each time it changes after the customer has been quoted.
          </p>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Rev #</th>
                <th>When</th>
                <th>By</th>
                <th>Sets &amp; prices at that point ({currency})</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.revisionNo}</td>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>{r.createdBy?.name ?? '-'}</td>
                  <td>
                    {r.snapshot.lines
                      .map((l) => `${l.color} - ${symbol}${(l.ratePerSet?.[currency] ?? 0).toFixed(4)}`)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isSupervisor && (
        <div className="panel">
          <div className="tag-row" style={{ justifyContent: 'space-between' }}>
            <strong>Commercial terms for this quote</strong>
            {!showTermsEditor && !pricingLocked && (
              <button className="btn small" onClick={openTermsEditor}>
                {[quote.marginPctOverride, quote.commissionPctOverride, quote.wcInterestPctOverride, quote.lcInterestPctOverride].some(
                  (v) => v != null,
                )
                  ? 'Edit overrides'
                  : 'Override terms'}
              </button>
            )}
          </div>

          {!showTermsEditor && (
            <div className="form-grid" style={{ marginTop: 10 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Margin %
                </div>
                {quote.marginPctOverride != null ? (
                  <>
                    {(quote.marginPctOverride * 100).toFixed(2)}%{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      (customer default {(quote.customer.marginPct * 100).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  `${(quote.customer.marginPct * 100).toFixed(2)}%`
                )}
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Commission %
                </div>
                {quote.commissionPctOverride != null ? (
                  <>
                    {(quote.commissionPctOverride * 100).toFixed(2)}%{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      (customer default {(quote.customer.commissionPct * 100).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  `${(quote.customer.commissionPct * 100).toFixed(2)}%`
                )}
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  WC Interest %
                </div>
                {quote.wcInterestPctOverride != null ? (
                  <>
                    {(quote.wcInterestPctOverride * 100).toFixed(2)}%{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      (customer default {(quote.customer.wcInterestPct * 100).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  `${(quote.customer.wcInterestPct * 100).toFixed(2)}%`
                )}
              </div>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  LC Interest %
                </div>
                {quote.lcInterestPctOverride != null ? (
                  <>
                    {(quote.lcInterestPctOverride * 100).toFixed(2)}%{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      (customer default {(quote.customer.lcInterestPct * 100).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  `${(quote.customer.lcInterestPct * 100).toFixed(2)}%`
                )}
              </div>
            </div>
          )}

          {showTermsEditor && (
            <div style={{ marginTop: 10 }}>
              <div className="form-grid">
                <div>
                  <label>Margin % (default {(quote.customer.marginPct * 100).toFixed(2)})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={(quote.customer.marginPct * 100).toFixed(2)}
                    value={termsForm.marginPct}
                    onChange={(e) => setTermsForm((f) => ({ ...f, marginPct: e.target.value }))}
                  />
                </div>
                <div>
                  <label>Commission % (default {(quote.customer.commissionPct * 100).toFixed(2)})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={(quote.customer.commissionPct * 100).toFixed(2)}
                    value={termsForm.commissionPct}
                    onChange={(e) => setTermsForm((f) => ({ ...f, commissionPct: e.target.value }))}
                  />
                </div>
                <div>
                  <label>WC Interest % (default {(quote.customer.wcInterestPct * 100).toFixed(2)})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={(quote.customer.wcInterestPct * 100).toFixed(2)}
                    value={termsForm.wcInterestPct}
                    onChange={(e) => setTermsForm((f) => ({ ...f, wcInterestPct: e.target.value }))}
                  />
                </div>
                <div>
                  <label>LC Interest % (default {(quote.customer.lcInterestPct * 100).toFixed(2)})</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={(quote.customer.lcInterestPct * 100).toFixed(2)}
                    value={termsForm.lcInterestPct}
                    onChange={(e) => setTermsForm((f) => ({ ...f, lcInterestPct: e.target.value }))}
                  />
                </div>
              </div>
              <div className="tag-row" style={{ marginTop: 10 }}>
                <button className="btn primary small" onClick={saveTermsOverride}>
                  Save
                </button>
                <button className="btn small" onClick={clearTermsOverride}>
                  Clear all overrides
                </button>
                <button className="btn small" onClick={() => setShowTermsEditor(false)}>
                  Cancel
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Leave a field blank to use the customer's standard value. Saving recalculates every set in this quote.
              </div>
            </div>
          )}
        </div>
      )}

      {isSupervisor &&
        quote.lines.length > 0 &&
        (() => {
          const consolidated = consolidatedMargin();
          if (!consolidated) return null;
          return (
            <div className="panel" style={{ marginBottom: 14 }}>
              <h4 style={{ margin: '0 0 8px' }}>Consolidated margin - whole enquiry</h4>
              <div className="highlight-stats">
                <div className="stat-tile">
                  <div className="stat-label">Blended margin %</div>
                  <div className="stat-value">{(consolidated.blendedPct * 100).toFixed(2)}%</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Total revenue ({currency})</div>
                  <div className="stat-value">
                    {symbol}
                    {consolidated.totalRevenue.toFixed(2)}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Total margin ({currency})</div>
                  <div className="stat-value">
                    {symbol}
                    {consolidated.totalMargin.toFixed(2)}
                  </div>
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Revenue-weighted across every priced set in this quote, in {currency} - updates immediately after any
                margin change (e.g. "Match to target price" on one set).
              </p>
            </div>
          );
        })()}

      {quote.lines.map((line, lineIdx) => {
        const setRollup: { ratePerSet: Record<string, number> } | null = line.costBreakupJson ? JSON.parse(line.costBreakupJson) : null;
        const ratePerSet = setRollup?.ratePerSet?.[currency];
        // Preview of the margin "Match target price" would set - see the endpoint's own
        // comment in routes/quotes.ts for the derivation.
        let requiredMarginPct: number | null = null;
        if (ratePerSet != null && line.targetPrice) {
          const commission = quote.commissionPctOverride ?? quote.customer.commissionPct;
          const currentMargin = line.marginPctOverride ?? quote.marginPctOverride ?? quote.customer.marginPct;
          const c = ratePerSet * (1 - (currentMargin + commission));
          requiredMarginPct = 1 - commission - c / line.targetPrice;
        }
        const isExpanded = expanded[line.id];
        const isSingle = isSingleLine(line.segments);
        const singleSeg = isSingle ? line.segments[0] : null;
        const singleItem = isSingle ? singleSeg!.items[0] : null;
        const singleLabel = singleSeg?.product?.name || singleSeg?.product?.code || '';
        const showDetailsButton = !isSingle || isSupervisor;
        // item.qtyKg is "one set's worth" (pieceWeight x qtyPerSet / 1000) - multiplying by
        // qtySets gives the total weight for the full order quantity.
        const lineTotalKg = line.segments.reduce(
          (sum, seg) => sum + seg.items.reduce((s, it) => s + (it.qtyKg ?? 0), 0),
          0,
        ) * line.qtySets;

        function segmentDetail(seg: (typeof line.segments)[number]) {
          const segLabel = seg.product?.name || seg.product?.code || `Product ${seg.productId}`;
          return (
            <div key={seg.id} style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              {!isSingle && (
                <h4 style={{ margin: '0 0 8px' }}>
                  Segment: {seg.product?.code} - {segLabel}
                  {pileYarnCode(seg) && <span className="muted"> - Pile Yarn: {pileYarnCode(seg)}</span>}
                </h4>
              )}

              {!isSingle && (
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Size (cm)</th>
                      <th className="right">GSM</th>
                      <th className="right">Qty/Set</th>
                      <th className="right">Qty in Kg</th>
                      <th className="right">Rate/Pc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seg.items.map((item) => {
                      const b: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
                      const totalKg = item.qtyKg != null ? item.qtyKg * line.qtySets : null;
                      return (
                        <Fragment key={item.id}>
                          <tr>
                            <td>{item.itemType?.name}</td>
                            <td>{sizeLabel(item)}</td>
                            <td className="right mono">{item.gsm}</td>
                            <td className="right mono">{item.qtyPerSet}</td>
                            <td className="right mono">{totalKg != null ? totalKg.toFixed(2) : '-'}</td>
                            <td className="right mono">{b?.ratePerPiece?.[currency] != null ? `${symbol}${b.ratePerPiece[currency].toFixed(4)}` : '-'}</td>
                          </tr>
                          {item.packagingCharges.length > 0 && (
                            <tr>
                              <td colSpan={6} className="muted" style={{ fontSize: 12 }}>
                                + Packaging: {item.packagingCharges.map((p) => `${p.description} (₹${p.ratePerPiece}/pc)`).join(', ')}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {isSupervisor && (
                <>
                  {seg.items.map((item) => {
                    const b: CostingBreakup | null = item.costBreakupJson ? JSON.parse(item.costBreakupJson) : null;
                    if (!b || !('yarnCostPerKg' in b)) return null;
                    const totalLossPct = b.bomMultiplier ? 1 - 1 / b.bomMultiplier : 0;
                    return (
                      <div key={`hl-${item.id}`}>
                        <div className="highlight-stats">
                          <div className="stat-tile">
                            <div className="stat-label">Rate / Kg</div>
                            <div className="stat-value">
                              {symbol}
                              {(b.ratePerKg?.[currency] ?? 0).toFixed(2)}
                            </div>
                          </div>
                          <div className="stat-tile">
                            <div className="stat-label">Margin %</div>
                            <div className="stat-value">{((b.marginPct ?? 0) * 100).toFixed(2)}%</div>
                          </div>
                          <div className="stat-tile">
                            <div className="stat-label">Margin % incl. DBK+ROSCTL/RODEP</div>
                            <div className="stat-value">{((b.effectiveMarginPctInclDbk ?? b.marginPct ?? 0) * 100).toFixed(2)}%</div>
                          </div>
                          <div className="stat-tile">
                            <div className="stat-label">Total BOM (yarn cost/kg)</div>
                            <div className="stat-value">₹{b.yarnCostPerKg.toFixed(2)}</div>
                          </div>
                          <div className="stat-tile">
                            <div className="stat-label">Total Loss %</div>
                            <div className="stat-value">{(totalLossPct * 100).toFixed(2)}%</div>
                          </div>
                          <div className="stat-tile">
                            <div className="stat-label">Total Profit / pc ({currency})</div>
                            <div className="stat-value">
                              {symbol}
                              {(b.profitInclDbk?.[currency] ?? 0).toFixed(4)}
                            </div>
                          </div>
                        </div>
                        <table className="breakup-table" key={`bk-${item.id}`} style={{ marginTop: 8 }}>
                        <thead>
                          <tr>
                            <th>{item.itemType?.name} - cost stack (per kg, INR)</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakupRows.map((r) => (
                            <tr key={r.key}>
                              <td>{r.label}</td>
                              <td className="mono">₹{Number(b[r.key]).toFixed(4)}</td>
                            </tr>
                          ))}
                          {b.hsnCode && (
                            <tr>
                              <td>HSN Code (DBK+ROSCTL/RODEP)</td>
                              <td className="mono">
                                {b.hsnCode} ({((b.totalIncentivePct ?? 0) * 100).toFixed(2)}%)
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 10 }}>
                    <h4 style={{ margin: '0 0 8px' }}>Yarn recipe (raw material price used)</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Slot</th>
                          <th>Material</th>
                          <th className="right">Mixing %</th>
                          <th className="right">Current Price (₹/kg)</th>
                          <th className="right">Override</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {seg.yarnComponents.map((c) => {
                          const ov = seg.materialOverrides?.find((o) => o.rawMaterialId === c.rawMaterialId);
                          const masterRate = rawMaterials.find((m) => m.id === c.rawMaterialId)?.currentRate?.pricePerKg ?? null;
                          const effectivePrice = ov?.overridePricePerKg ?? masterRate;
                          return (
                            <tr key={c.id}>
                              <td>{c.slot}</td>
                              <td>{c.rawMaterial?.code}</td>
                              <td className="right mono">{c.mixingPct}</td>
                              <td className="right mono">{effectivePrice != null ? `₹${effectivePrice}` : '-'}</td>
                              <td className="right mono">{ov ? `₹${ov.overridePricePerKg} (${ov.reason || 'override'})` : '-'}</td>
                              <td className="right">
                                {!pricingLocked && (
                                  <button
                                    className="btn small"
                                    onClick={() => {
                                      setOverrideForSegment(seg.id!);
                                      setOverrideMaterialId(c.rawMaterialId);
                                      setOverridePrice(String(ov?.overridePricePerKg ?? masterRate ?? ''));
                                    }}
                                  >
                                    Override price
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {overrideForSegment === seg.id && (
                      <div className="panel" style={{ marginTop: 10, background: 'var(--blue-light)' }}>
                        <div className="form-grid">
                          <div className="field">
                            <label>Override price / kg (₹)</label>
                            <input type="number" value={overridePrice} onChange={(e) => setOverridePrice(e.target.value)} />
                          </div>
                          <div className="field">
                            <label>Reason (notified to Purchase)</label>
                            <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. bulk deal for this order" />
                          </div>
                        </div>
                        <div className="modal-actions">
                          <button className="btn" onClick={() => setOverrideForSegment(null)}>
                            Cancel
                          </button>
                          <button className="btn primary" onClick={() => submitOverride(seg.id!)}>
                            Apply override
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        }

        return (
          <div className="line-card" key={line.id}>
            <div className="line-head">
              <div>
                <strong>Set #{lineIdx + 1}</strong>
                {isSingle ? (
                  <>
                    {' '}
                    - {singleSeg!.product?.code}
                    {singleLabel ? ` (${singleLabel})` : ''} - {singleItem!.itemType?.name} - {line.color} - {sizeLabel(singleItem!)}, GSM{' '}
                    {singleItem!.gsm}
                    {pileYarnCode(singleSeg!) && ` - Pile Yarn: ${pileYarnCode(singleSeg!)}`} - Qty {line.qtySets.toLocaleString()} pcs (
                    {lineTotalKg.toFixed(2)} kg)
                  </>
                ) : (
                  <>
                    {' '}
                    - Color: {line.color} - {line.qtySets.toLocaleString()} set(s) ordered
                    <span className="muted"> ({line.segments.length} segments, bundled)</span>
                  </>
                )}
                {isSingle && singleItem!.packagingCharges.length > 0 && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    + Packaging: {singleItem!.packagingCharges.map((p) => `${p.description} (₹${p.ratePerPiece}/pc)`).join(', ')}
                  </div>
                )}
              </div>
              <div className="tag-row">
                {showDetailsButton && (
                  <button className="btn small" onClick={() => setExpanded((e) => ({ ...e, [line.id]: !e[line.id] }))}>
                    {isExpanded ? 'Hide' : 'Show'} details
                  </button>
                )}
                {canEditLines && (
                  <>
                    <button className="btn small" onClick={() => saveLineAsTemplate(line.id)} title="Save this set's recipe for repeat orders from this customer">
                      Save as template
                    </button>
                    <button className="btn small" onClick={() => startEditSet(line)}>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => removeLine(line.id)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th></th>
                  <th className="right">{currency}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{isSingle ? 'Rate / Piece' : 'Combined price / set'}</td>
                  <td className="right mono">{ratePerSet != null ? `${symbol}${ratePerSet.toFixed(4)}` : '-'}</td>
                </tr>
                <tr>
                  <td>
                    Total for {line.qtySets.toLocaleString()} {isSingle ? 'pcs' : 'set(s)'}
                    <span className="muted"> ({lineTotalKg.toFixed(2)} kg)</span>
                  </td>
                  <td className="right mono">{ratePerSet != null ? `${symbol}${(ratePerSet * line.qtySets).toFixed(2)}` : '-'}</td>
                </tr>
              </tbody>
            </table>

            {isSupervisor && (
              <div style={{ marginTop: 8 }}>
                <div className="tag-row" style={{ alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Margin for this set:{' '}
                    {line.marginPctOverride != null ? (
                      <strong>{(line.marginPctOverride * 100).toFixed(2)}% (override)</strong>
                    ) : (
                      'using quote/customer default'
                    )}
                  </span>
                  {!pricingLocked && editMarginForLine !== line.id && (
                    <button
                      className="btn small"
                      onClick={() => {
                        setEditMarginForLine(line.id);
                        setMarginInputPct(line.marginPctOverride != null ? String(line.marginPctOverride * 100) : '');
                      }}
                    >
                      Set margin %
                    </button>
                  )}
                  {!pricingLocked && line.marginPctOverride != null && (
                    <button className="btn small" onClick={() => clearLineMarginOverride(line.id)}>
                      Clear override
                    </button>
                  )}
                </div>
                {editMarginForLine === line.id && (
                  <div className="tag-row" style={{ marginTop: 6 }}>
                    <input
                      type="number"
                      step="0.01"
                      style={{ maxWidth: 120 }}
                      value={marginInputPct}
                      onChange={(e) => setMarginInputPct(e.target.value)}
                      placeholder="Margin %"
                    />
                    <button className="btn primary small" onClick={() => applyLineMarginOverride(line.id)}>
                      Apply
                    </button>
                    <button className="btn small" onClick={() => setEditMarginForLine(null)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {isSupervisor && line.targetPrice != null && (
              <div style={{ marginTop: 8 }}>
                <table>
                  <tbody>
                    <tr>
                      <td>Target price</td>
                      <td className="right mono">
                        {symbol}
                        {line.targetPrice.toFixed(4)}
                      </td>
                    </tr>
                    <tr>
                      <td>Difference to target</td>
                      <td className="right mono">
                        {ratePerSet != null ? `${symbol}${(ratePerSet - line.targetPrice).toFixed(4)}` : '-'}
                      </td>
                    </tr>
                    <tr>
                      <td>Margin needed to hit target</td>
                      <td className="right mono">{requiredMarginPct != null ? `${(requiredMarginPct * 100).toFixed(2)}%` : '-'}</td>
                    </tr>
                  </tbody>
                </table>
                {!pricingLocked && (
                  <div className="tag-row" style={{ marginTop: 6 }}>
                    <button className="btn small" onClick={() => matchTargetPrice(line.id)}>
                      Match target price
                    </button>
                  </div>
                )}
              </div>
            )}

            {isExpanded && <div style={{ marginTop: 14 }}>{line.segments.map(segmentDetail)}</div>}
          </div>
        );
      })}

      {quote.lines.length === 0 && <p className="muted">No lines yet.</p>}

      {canEditLines && !showForm && (
        <div className="tag-row">
          <button className="btn primary" onClick={startNewSet}>
            + Add set
          </button>
          {templateGroups.length > 0 && (
            <select
              value={selectedGroupId}
              disabled={applyingGroup}
              onChange={(e) => e.target.value && applyTemplateGroup(Number(e.target.value))}
            >
              <option value="">{applyingGroup ? 'Applying recipe...' : 'Apply saved recipe (whole quote)...'}</option>
              {templateGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.setCount} set{g.setCount === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {canEditLines && showForm && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>{editingLineId ? 'Edit set' : 'New set'}</h3>

          {!editingLineId && templates.length > 0 && (
            <div className="field" style={{ maxWidth: 360, marginBottom: 12 }}>
              <label>Load from template (this customer's saved recipes)</label>
              <select value={selectedTemplateId} onChange={(e) => (e.target.value ? loadTemplate(Number(e.target.value)) : setSelectedTemplateId(''))}>
                <option value="">Start from scratch...</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="tag-row" style={{ marginBottom: 10 }}>
            <button className={`btn small ${mode === 'single' ? 'primary' : ''}`} onClick={toSingleMode} disabled={!canUseSingleMode(form)}>
              Single Product
            </button>
            <button className={`btn small ${mode === 'bundle' ? 'primary' : ''}`} onClick={() => setMode('bundle')}>
              Set / Bundle
            </button>
            {!canUseSingleMode(form) && mode === 'bundle' && (
              <span className="muted" style={{ fontSize: 12 }}>
                Remove extra segments/items to switch back to Single Product.
              </span>
            )}
          </div>
          {mode === 'bundle' && (
            <p className="muted" style={{ marginTop: -6 }}>
              For a bundled gift set (e.g. a bath towel + hand towel sold together at one combined price), add more
              than one segment below - each segment is one yarn quality, and can itself include more than one sized
              item sharing that yarn.
            </p>
          )}

          <div className="form-grid">
            <div className="field">
              <label>Color</label>
              <input list="colors" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              <datalist id="colors">
                {colors.map((c) => (
                  <option key={c.id} value={c.color} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>{mode === 'single' ? 'Qty (pcs)' : 'Sets ordered'}</label>
              <input type="number" value={form.qtySets} onChange={(e) => setForm({ ...form, qtySets: e.target.value })} />
            </div>
            <div className="field">
              <label>Target price (optional)</label>
              <input type="number" value={form.targetPrice} onChange={(e) => setForm({ ...form, targetPrice: e.target.value })} />
            </div>
          </div>

          {form.segments.map((seg, segIdx) => (
            <div key={segIdx} className="panel" style={{ marginTop: 14, background: 'var(--bg)' }}>
              {mode === 'bundle' && (
                <div className="toolbar">
                  <h4 style={{ margin: 0 }}>
                    Segment {segIdx + 1}{' '}
                    <span className={Math.abs(segmentMixingTotal(seg) - 100) > 0.5 ? 'badge rejected' : 'badge approved'}>
                      mixing {segmentMixingTotal(seg).toFixed(1)}%
                    </span>
                  </h4>
                  {form.segments.length > 1 && (
                    <button className="btn small danger" onClick={() => removeSegment(segIdx)}>
                      Remove segment
                    </button>
                  )}
                </div>
              )}

              <div className="field" style={{ maxWidth: 320 }}>
                <label>Product (quality)</label>
                <select value={seg.productId} onChange={(e) => setSegmentProduct(segIdx, Number(e.target.value))}>
                  <option value="">Select...</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}
                      {p.name ? ` - ${p.name}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {mode === 'bundle' || showYarnEditorSingle ? (
                <div style={{ marginTop: 10 }}>
                  <div className="toolbar">
                    <strong style={{ fontSize: 13 }}>Yarn recipe</strong>
                    <div className="tag-row">
                      <button className="btn small" onClick={() => addYarnRow(segIdx)}>
                        + Add slot
                      </button>
                      {mode === 'single' && (
                        <button className="btn small" onClick={() => setShowYarnEditorSingle(false)}>
                          Hide
                        </button>
                      )}
                    </div>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Slot</th>
                        <th>Raw material</th>
                        <th className="right">Mixing %</th>
                        {products.find((p) => p.id === seg.productId)?.colorMethod === 'YARN_DYED' && <th className="right">Dyeing cost/kg (₹)</th>}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {seg.yarnComponents.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          <td>
                            <input value={row.slot} onChange={(e) => updateYarnRow(segIdx, rowIdx, { slot: e.target.value })} style={{ width: 100 }} />
                          </td>
                          <td>
                            <select value={row.rawMaterialId} onChange={(e) => updateYarnRow(segIdx, rowIdx, { rawMaterialId: Number(e.target.value) })}>
                              <option value="">Select...</option>
                              {rawMaterials.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="right">
                            <input
                              type="number"
                              step="0.1"
                              value={row.mixingPct}
                              onChange={(e) => updateYarnRow(segIdx, rowIdx, { mixingPct: Number(e.target.value) })}
                              style={{ width: 70, textAlign: 'right' }}
                            />
                          </td>
                          {products.find((p) => p.id === seg.productId)?.colorMethod === 'YARN_DYED' && (
                            <td className="right">
                              <input
                                type="number"
                                step="0.1"
                                value={row.dyeingCostPerKg}
                                onChange={(e) => updateYarnRow(segIdx, rowIdx, { dyeingCostPerKg: Number(e.target.value) })}
                                style={{ width: 90, textAlign: 'right' }}
                              />
                            </td>
                          )}
                          <td>
                            <button className="btn small danger" onClick={() => removeYarnRow(segIdx, rowIdx)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ marginTop: 10 }}>
                  <button className="btn small" onClick={() => setShowYarnEditorSingle(true)}>
                    Edit yarn recipe (advanced)
                  </button>
                </div>
              )}

              {mode === 'bundle' && (
                <div style={{ marginTop: 14 }}>
                  <div className="toolbar">
                    <strong style={{ fontSize: 13 }}>Items (from this segment's yarn)</strong>
                    <button className="btn small" onClick={() => addItem(segIdx)}>
                      + Add item
                    </button>
                  </div>
                </div>
              )}
              <div style={mode === 'single' ? { marginTop: 14 } : undefined}>
                {seg.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="panel" style={{ marginTop: 8 }}>
                    <div className="form-grid">
                      <div className="field">
                        <label>Item Type</label>
                        <select value={item.itemTypeId} onChange={(e) => updateItem(segIdx, itemIdx, { itemTypeId: Number(e.target.value) })}>
                          <option value="">Select...</option>
                          {itemTypes.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {itemTypes.find((t) => t.id === item.itemTypeId)?.sizingMethod === 'FABRIC_CONSUMPTION' ? (
                        <div className="field">
                          <label>Fabric consumption (sqm/pc)</label>
                          <input
                            type="number"
                            value={item.fabricConsumptionSqm}
                            onChange={(e) => updateItem(segIdx, itemIdx, { fabricConsumptionSqm: e.target.value })}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="field">
                            <label>Length (cm)</label>
                            <input type="number" value={item.lengthCm} onChange={(e) => updateItem(segIdx, itemIdx, { lengthCm: e.target.value })} />
                          </div>
                          <div className="field">
                            <label>Width (cm)</label>
                            <input type="number" value={item.widthCm} onChange={(e) => updateItem(segIdx, itemIdx, { widthCm: e.target.value })} />
                          </div>
                        </>
                      )}
                      <div className="field">
                        <label>GSM</label>
                        <input type="number" value={item.gsm} onChange={(e) => updateItem(segIdx, itemIdx, { gsm: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>HSN Code (Duty Drawback)</label>
                        <select
                          value={item.hsnCodeId}
                          onChange={(e) => updateItem(segIdx, itemIdx, { hsnCodeId: e.target.value ? Number(e.target.value) : '' })}
                        >
                          <option value="">None</option>
                          {hsnCodes.map((h) => (
                            <option key={h.id} value={h.id}>
                              {h.description} - {h.hsCode}
                            </option>
                          ))}
                        </select>
                      </div>
                      {mode === 'bundle' && (
                        <div className="field">
                          <label>Qty / Set</label>
                          <input type="number" value={item.qtyPerSet} onChange={(e) => updateItem(segIdx, itemIdx, { qtyPerSet: e.target.value })} />
                        </div>
                      )}
                      {seg.items.length > 1 && (
                        <div className="field" style={{ justifyContent: 'flex-end' }}>
                          <label>&nbsp;</label>
                          <button className="btn small danger" onClick={() => removeItem(segIdx, itemIdx)}>
                            Remove item
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div className="toolbar">
                        <span className="muted" style={{ fontSize: 12 }}>
                          Additional packaging charges (₹/pc)
                        </span>
                        <button className="btn small" onClick={() => addPackagingCharge(segIdx, itemIdx)}>
                          + Add charge
                        </button>
                      </div>
                      {item.packagingCharges.map((charge, chargeIdx) => (
                        <div key={chargeIdx} className="tag-row" style={{ marginTop: 4 }}>
                          <input
                            placeholder="Description, e.g. gift box"
                            value={charge.description}
                            onChange={(e) => updatePackagingCharge(segIdx, itemIdx, chargeIdx, { description: e.target.value })}
                            style={{ flex: 1 }}
                          />
                          <input
                            type="number"
                            placeholder="Rate/pc"
                            value={charge.ratePerPiece}
                            onChange={(e) => updatePackagingCharge(segIdx, itemIdx, chargeIdx, { ratePerPiece: e.target.value })}
                            style={{ width: 90 }}
                          />
                          <button className="btn small danger" onClick={() => removePackagingCharge(segIdx, itemIdx, chargeIdx)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {mode === 'bundle' && (
            <div className="tag-row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={addSegment}>
                + Add segment (bundle in another item)
              </button>
            </div>
          )}

          <div className="tag-row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={cancelForm}>
              Cancel
            </button>
            <button className="btn primary" onClick={submitSet} disabled={!formIsValid()}>
              {editingLineId ? 'Save set' : 'Add set'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
