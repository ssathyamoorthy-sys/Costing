import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { rawMaterialsRouter } from './routes/rawMaterials';
import { productsRouter } from './routes/products';
import { itemTypesRouter } from './routes/itemTypes';
import { processingChargesRouter } from './routes/processingCharges';
import { accessoryTypesRouter } from './routes/accessoryTypes';
import { customersRouter } from './routes/customers';
import { exchangeRatesRouter } from './routes/exchangeRates';
import { quotesRouter } from './routes/quotes';
import { notificationsRouter } from './routes/notifications';

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
app.use('/api/customers', customersRouter);
app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/notifications', notificationsRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`Terry towel costing API listening on http://localhost:${PORT}`);
});
