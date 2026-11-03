import mongoose, { Schema, Document, Types } from "mongoose";

export interface IBill {
  label: string;
  amount: number;
}

export interface IMixMaterial {
  label: string;
  qty: string;
  rairi: number;
  rate: number;
  amount: number;
  trolleyEntryId?: string;
}

export interface IBlockDaily extends Document {
  date: Date;
  cementBags: number;
  blocksMade: string;
  blocksCount: number;
  dailyWages: number;
  ratePerBlock: number;
  blockType: string;
  userId: Types.ObjectId | string;
  bills: IBill[];
  mixMaterials: IMixMaterial[];
  totalBill: number;
  costPerBlock: number;
  isMonthlyElectricity: boolean;
  mixCost: number;
  localId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BillSchema = new Schema<IBill>({
  label: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
}, { _id: false });

const MixMaterialSchema = new Schema<IMixMaterial>({
  label: { type: String, required: true, trim: true },
  qty: { type: String, trim: true, default: "" },
  rairi: { type: Number, default: 0, min: 0 },
  rate: { type: Number, default: 0, min: 0 },
  amount: { type: Number, default: 0, min: 0 },
  trolleyEntryId: { type: String, trim: true },
}, { _id: false });

const BlockDailySchema = new Schema<IBlockDaily>({
  date: { type: Date, required: true, default: Date.now, index: true },
  cementBags: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  blocksMade: { type: String, required: true, trim: true, index: true },
  blocksCount: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  dailyWages: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  ratePerBlock: { type: Number, default: 3, min: 0, set: (v: number) => Math.round(v || 0) },
  blockType: { type: String, default: "6 inch", index: true },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  bills: { type: [BillSchema], default: [] },
  mixMaterials: { type: [MixMaterialSchema], default: [] },
  totalBill: { type: Number, default: 0, min: 0 },
  mixCost: { type: Number, default: 0, min: 0 },
  costPerBlock: { type: Number, default: 0, min: 0 },
  isMonthlyElectricity: { type: Boolean, default: false },
  localId: { type: String, trim: true, index: true },
}, { timestamps: true });

BlockDailySchema.pre("validate", function () {
  if (!this.date) this.date = new Date();

  this.mixMaterials.forEach((m) => {
    const mix = m as IMixMaterial;
    if (!mix.rairi && mix.qty) {
      const num = parseInt(mix.qty.replace(/[^0-9]/g, "") || "0", 10);
      mix.rairi = Number.isNaN(num) ? 0 : num;
    }
    if (mix.rairi && mix.rate) {
      mix.amount = Math.round(mix.rairi * mix.rate);
    } else if (!mix.amount) {
      mix.amount = 0;
    }
  });

  if (this.blocksCount && this.ratePerBlock) {
    this.dailyWages = Math.round(this.blocksCount * this.ratePerBlock);
  }

  const extraBills = this.bills.reduce((sum: number, b: IBill) => {
    if (b.label.toLowerCase().includes("labour")) return sum;
    if (this.isMonthlyElectricity && (b.label.toLowerCase().includes("electric") || b.label.includes("بجلی"))) return sum;
    return sum + (b.amount || 0);
  }, 0);

  const mixCost = this.mixMaterials.reduce((s: number, m: IMixMaterial) => s + (m.amount || 0), 0);
  this.mixCost = mixCost;

  this.totalBill = (this.dailyWages || 0) + extraBills + mixCost;

  if (this.blocksCount > 0) {
    this.costPerBlock = Math.round((this.totalBill / this.blocksCount) * 100) / 100;
  }
});

BlockDailySchema.index({ userId: 1, date: -1 });
BlockDailySchema.index({ userId: 1, blocksMade: 1 });
BlockDailySchema.index({ userId: 1, localId: 1 }, { unique: true, sparse: true });

const BlockDailyModel =
  (mongoose.models.BlockDaily as mongoose.Model<IBlockDaily>) ||
  mongoose.model<IBlockDaily>("BlockDaily", BlockDailySchema);

export default BlockDailyModel;