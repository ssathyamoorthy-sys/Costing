import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { authRouter } from './routes/auth';
import { rawMaterialsRouter } from './routes/rawMaterials';
import { productsRouter } from './routes/products';
import { itemTypesRouter } from './routes/itemTypes';
import { processingChargesRouter } from './routes/processingCharges';
import { accessoryTypesRouter } from './routes/accessoryTypes';
import { hsnCodesRouter } from './routes/hsnCodes';
import { customersRouter } from './routes/customers';
import { exchangeRatesRouter } from './routes/exchangeRates';
import { quotesRouter } from './routes/quotes';
import { quoteTemplatesRouter } from './routes/quoteTemplates';
import { notificationsRouter } from './routes/notifications';
import { generalSettingsRouter } from './routes/generalSettings';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRouter);
app.use('/api/raw-materials', rawMaterialsRouter);
app.use('/api/products', productsRouter);
app.use('/api/item-types', itemTypesRouter);
app.use('/api/processing-charges', processingChargesRouter);
app.use('/api/accessory-types', accessoryTypesRouter);
app.use('/api/hsn-codes', hsnCodesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/quote-templates', quoteTemplatesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/general-settings', generalSettingsRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Single-process deployment: if the frontend has been built (frontend/dist),
// serve it here so the whole app runs as one Node process on one port.
// In local dev, frontend/dist won't exist yet - run the Vite dev server
// separately instead (see frontend/package.json "dev" script).
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`Terry towel costing API listening on http://localhost:${PORT}`);
});
