import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(username: string, name: string, role: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { username },
    update: {},
    create: { username, name, role, passwordHash },
  });
}

async function main() {
  console.log('Seeding users...');
  const admin = await upsertUser('admin', 'System Admin', 'ADMIN', 'ChangeMe123!');
  const supervisor = await upsertUser('supervisor', 'Supervisor', 'SUPERVISOR', 'ChangeMe123!');
  const purchase = await upsertUser('purchase', 'Purchase User', 'PURCHASE', 'ChangeMe123!');
  const merchandiser = await upsertUser('merchandiser', 'Merchandiser', 'MERCHANDISER', 'ChangeMe123!');

  console.log('Seeding item types (stitching/packing cost per kg)...');
  const itemTypeDefs = [
    { name: 'Bath Towel', stitchingCostPerKg: 15, packingCostPerKg: 10 },
    { name: 'Hand Towel', stitchingCostPerKg: 18, packingCostPerKg: 10 },
    { name: 'Bath Sheet', stitchingCostPerKg: 14, packingCostPerKg: 10 },
    { name: 'Face Towel', stitchingCostPerKg: 20, packingCostPerKg: 10 },
    { name: 'Bathrobe', stitchingCostPerKg: 25, packingCostPerKg: 12 },
  ];
  const itemTypes: Record<string, { id: number }> = {};
  for (const def of itemTypeDefs) {
    itemTypes[def.name] = await prisma.itemType.upsert({
      where: { name: def.name },
      update: {},
      create: def,
    });
  }

  console.log('Seeding raw materials + approved starting rates...');
  const rawMaterialDefs = [
    { code: '2/20s OE', description: 'Ground yarn', price: 265 },
    { code: '1/16s K', description: 'Pile yarn', price: 274 },
    { code: '12s OE', description: 'Weft yarn', price: 214 },
    { code: '2/20s Scoured', description: 'Scoured yarn', price: 310 },
  ];
  const rawMaterials: Record<string, { id: number }> = {};
  for (const def of rawMaterialDefs) {
    const material = await prisma.rawMaterial.upsert({
      where: { code: def.code },
      update: {},
      create: { code: def.code, description: def.description },
    });
    rawMaterials[def.code] = material;

    const existingRate = await prisma.rawMaterialRate.findFirst({ where: { rawMaterialId: material.id } });
    if (!existingRate) {
      await prisma.rawMaterialRate.create({
        data: {
          rawMaterialId: material.id,
          pricePerKg: def.price,
          validFrom: new Date(),
          status: 'APPROVED',
          enteredById: purchase.id,
          approvedById: supervisor.id,
          approvedAt: new Date(),
        },
      });
    }
  }

  console.log('Seeding processing charges by color...');
  const processingChargeDefs = [
    { color: 'White', ratePerKg: 50 },
    { color: 'PDD', ratePerKg: 50 },
    { color: 'PWD', ratePerKg: 90 },
  ];
  for (const def of processingChargeDefs) {
    await prisma.processingCharge.upsert({ where: { color: def.color }, update: {}, create: def });
  }

  console.log('Seeding accessory types...');
  const accessoryTypeNames = ['Brand', 'Wash Care', 'Barcode', 'Tag', 'Satin Tape', 'Washing', 'Embroidery', 'Fringes', 'Others'];
  const accessoryTypes: Record<string, { id: number }> = {};
  for (const name of accessoryTypeNames) {
    accessoryTypes[name] = await prisma.accessoryType.upsert({ where: { name }, update: {}, create: { name } });
  }

  console.log('Seeding sample products (PDD, PWD)...');
  const productDefs = [
    {
      code: 'PDD',
      name: 'Plain Dyed Dobby',
      weavingWastagePct: 0.025,
      weavingSizingCostPerKg: 45,
      firstVelourCharges: 0,
      firstVelourLossPct: 0,
      secondVelourCharges: 0,
      secondVelourLossPct: 0,
      weightLossPct: 0.08,
      transportLocalPerKg: 3,
      rejectionPct: 0.03,
      yarnComponents: [
        { slot: 'Ground', code: '2/20s OE', mixingPct: 20 },
        { slot: 'Pile', code: '1/16s K', mixingPct: 60 },
        { slot: 'Weft', code: '12s OE', mixingPct: 17 },
        { slot: 'Scoured', code: '2/20s Scoured', mixingPct: 3 },
      ],
      accessories: [{ name: 'Wash Care', costPerPiece: 1 }],
    },
    {
      code: 'PWD',
      name: 'Plain White Dobby',
      weavingWastagePct: 0.025,
      weavingSizingCostPerKg: 45,
      firstVelourCharges: 0,
      firstVelourLossPct: 0,
      secondVelourCharges: 0,
      secondVelourLossPct: 0,
      weightLossPct: 0.08,
      transportLocalPerKg: 3,
      rejectionPct: 0.03,
      yarnComponents: [
        { slot: 'Ground', code: '2/20s OE', mixingPct: 20 },
        { slot: 'Pile', code: '1/16s K', mixingPct: 60 },
        { slot: 'Weft', code: '12s OE', mixingPct: 17 },
        { slot: 'Scoured', code: '2/20s Scoured', mixingPct: 3 },
      ],
      accessories: [{ name: 'Wash Care', costPerPiece: 1 }],
    },
  ];

  for (const def of productDefs) {
    const existing = await prisma.product.findUnique({ where: { code: def.code } });
    if (existing) continue;
    const product = await prisma.product.create({
      data: {
        code: def.code,
        name: def.name,
        weavingWastagePct: def.weavingWastagePct,
        weavingSizingCostPerKg: def.weavingSizingCostPerKg,
        firstVelourCharges: def.firstVelourCharges,
        firstVelourLossPct: def.firstVelourLossPct,
        secondVelourCharges: def.secondVelourCharges,
        secondVelourLossPct: def.secondVelourLossPct,
        weightLossPct: def.weightLossPct,
        transportLocalPerKg: def.transportLocalPerKg,
        rejectionPct: def.rejectionPct,
        yarnComponents: {
          create: def.yarnComponents.map((c) => ({
            slot: c.slot,
            rawMaterialId: rawMaterials[c.code].id,
            mixingPct: c.mixingPct,
          })),
        },
        accessories: {
          create: def.accessories.map((a) => ({ accessoryTypeId: accessoryTypes[a.name].id, costPerPiece: a.costPerPiece })),
        },
      },
    });
    console.log(`  created product ${product.code}`);
  }

  console.log('Seeding sample customer (Greenline)...');
  await prisma.customer.upsert({
    where: { name: 'Greenline' },
    update: {},
    create: {
      name: 'Greenline',
      paymentTerms: 'LC 60 days or TT 60 days from date of shipment',
      freightTerms: 'FOB Tuticorin sea port',
      wcInterestPct: 0.01,
      lcInterestPct: 0.01,
      marginPct: -0.03,
      commissionPct: 0.03,
    },
  });

  console.log('Seeding exchange rates (USD, GBP, EUR)...');
  const rateDefs = [
    { currency: 'USD', ratePerInr: 95 },
    { currency: 'GBP', ratePerInr: 110 },
    { currency: 'EUR', ratePerInr: 100 },
  ];
  for (const def of rateDefs) {
    const existing = await prisma.exchangeRate.findFirst({ where: { currency: def.currency } });
    if (!existing) {
      await prisma.exchangeRate.create({
        data: { currency: def.currency, ratePerInr: def.ratePerInr, validFrom: new Date(), enteredById: supervisor.id },
      });
    }
  }

  console.log('Seeding general settings (export freight)...');
  await prisma.generalSetting.upsert({
    where: { key: 'freightExportPerKg' },
    update: {},
    create: { key: 'freightExportPerKg', value: '13' },
  });

  console.log('Done. Seeded users (username / password):');
  console.log('  admin / ChangeMe123!');
  console.log('  supervisor / ChangeMe123!');
  console.log('  purchase / ChangeMe123!');
  console.log('  merchandiser / ChangeMe123!');
  console.log('CHANGE THESE PASSWORDS after first login.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
