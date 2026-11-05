import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBill {
  label: string;
  amount: number;
}

export interface IMixMaterial {
  label: string;
  qty: string;
  rairi: number;
  rate: number; // Frozen per Rairi - Maneray 60 / Ghata 55
  amount: number;
  trolleyEntryId?: string;
  batchId?: string;
}

export interface IBlockDaily extends Document {
  date: Date;
  cementBags: number;
  cementRate: number;
  cementCost: number;
  blocksMade: string;
  blocksCount: number;
  mazdoorRatePerBlock: number;
  ratePerBlock: number;
  dailyWages: number;
  labourCost: number;
  blockType: string;
  userId: Types.ObjectId | string;
  bills: IBill[];
  mixMaterials: IMixMaterial[];
  trolleyMixCost: number;
  mixCost: number;
  totalBill: number;
  costPerBlock: number;
  isMonthlyElectricity: boolean;
  batchId?: string;
  localId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BillSchema = new Schema<IBill>({
  label: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, default: 0, min: 0, set: (v: number): number => Math.round(v || 0) },
}, { _id: false });

const MixMaterialSchema = new Schema<IMixMaterial>({
  label: { type: String, required: true, trim: true },
  qty: { type: String, trim: true, default: "" },
  rairi: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  rate: { type: Number, default: 0, min: 0 },
  amount: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  trolleyEntryId: { type: String, trim: true },
  batchId: { type: String, trim: true, required: false },
}, { _id: false });

const BlockDailySchema = new Schema<IBlockDaily>({
  date: { type: Date, required: true, default: Date.now, index: true },
  
  cementBags: { 
    type: Number, 
    required: false, 
    min: 0, 
    default: 0, 
    set: (v: number): number => Math.round(v || 0) 
  },
  cementRate: { type: Number, required: false, default: 1400, min: 0, set: (v: number) => Math.round(v || 0) },
  cementCost: { type: Number, default: 0, min: 0 },
  
  blocksMade: { type: String, required: true, trim: true, index: true },
  blocksCount: { type: Number, required: true, min: 0, set: (v: number): number => Math.round(v || 0) },
  
  mazdoorRatePerBlock: { type: Number, default: 3, min: 0 },
  ratePerBlock: { type: Number, default: 3, min: 0 },
  dailyWages: { type: Number, required: false, min: 0, default: 0 },
  labourCost: { type: Number, default: 0, min: 0 },
  
  blockType: { type: String, default: "6 inch", index: true },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  bills: { type: [BillSchema], default: [] },
  mixMaterials: { type: [MixMaterialSchema], default: [] },
  
  trolleyMixCost: { type: Number, default: 0, min: 0 },
  mixCost: { type: Number, default: 0, min: 0 },
  totalBill: { type: Number, default: 0, min: 0 },
  costPerBlock: { type: Number, default: 0, min: 0 },
  isMonthlyElectricity: { type: Boolean, default: false },
  batchId: { type: String, required: false, trim: true },
  localId: { type: String, trim: true, index: true },
}, { 
  timestamps: true,
  strict: false,
});

BlockDailySchema.pre("validate", function () {
  const doc = this as unknown as Record<string, unknown> & IBlockDaily;

  // cementBori -> cementBags map
  if (doc["cementBori"] !== undefined && !doc.cementBags) {
    doc.cementBags = Math.round(Number(doc["cementBori"] as number) || 0);
  }
  if (!doc.cementBags) doc.cementBags = 0;
  if (!doc.date) doc.date = new Date() as unknown as Date;

  // 1. Cement - Bori * Rate
  const rate = doc.cementRate || 1400;
  doc.cementRate = Math.round(rate);
  doc.cementCost = Math.round((doc.cementBags || 0) * rate);

  // 2. Mazdoor - 1 block = 3 Rs
  const mRate = doc.mazdoorRatePerBlock || doc.ratePerBlock || 3;
  doc.mazdoorRatePerBlock = mRate;
  doc.ratePerBlock = mRate;
  doc.dailyWages = Math.round((doc.blocksCount || 0) * mRate);
  doc.labourCost = doc.dailyWages;

  // 3. Trolley mix - frozen rate, tiny improvement
  doc.mixMaterials.forEach((m) => {
    const mix = m as IMixMaterial;
    // qty string se rairi nikalna e.g. "10 rairi"
    if ((!mix.rairi || mix.rairi === 0) && mix.qty) {
      const num = parseInt(mix.qty.replace(/[^0-9]/g, "") || "0", 10);
      mix.rairi = Number.isNaN(num) ? 0 : num;
    }
    // Frozen rate touch with trolley - rate change nahi hoga
    if (mix.rairi && mix.rate) {
      mix.rate = Number(Number(mix.rate).toFixed(2)); // 1100, 216.67 fix
      mix.amount = Math.round(mix.rairi * mix.rate);
    } else {
      mix.amount = Math.round(mix.amount || 0);
    }
  });

  // 4. Totals - Labour duplicate avoid + monthly bijli skip
  const extraBills = doc.bills.reduce((sum: number, b: IBill) => {
    const l = b.label.toLowerCase();
    if (l.includes("labour") || b.label.includes("مزدوری") || l.includes("mazdoor")) return sum;
    if (doc.isMonthlyElectricity && (l.includes("electric") || b.label.includes("بجلی"))) return sum;
    return sum + (b.amount || 0);
  }, 0);

  doc.trolleyMixCost = doc.mixMaterials.reduce((s, m) => s + (m.amount || 0), 0);
  doc.mixCost = doc.trolleyMixCost + doc.cementCost;
  doc.totalBill = doc.labourCost + extraBills + doc.mixCost;

  if (doc.blocksCount > 0) {
    doc.costPerBlock = Math.round((doc.totalBill / doc.blocksCount) * 100) / 100;
  } else {
    doc.costPerBlock = 0;
  }

  // batchId auto if not
  if (!doc.batchId && doc.localId) doc.batchId = doc.localId;
});

BlockDailySchema.index({ userId: 1, date: -1 });
BlockDailySchema.index({ userId: 1, localId: 1 }, { unique: true, sparse: true });
BlockDailySchema.index({ userId: 1, blockType: 1 });

const BlockDailyModel =
  (mongoose.models.BlockDaily as mongoose.Model<IBlockDaily>) ||
  mongoose.model<IBlockDaily>("BlockDaily", BlockDailySchema);

export default BlockDailyModel;