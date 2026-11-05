import mongoose, { Schema, Document, Types } from "mongoose";

export type TrolleyStatus = "OPEN" | "CLOSED" | "SOLD";
export type TrolleyPurpose = "factory" | "direct_sale";

export interface ITrolleyEntry extends Document {
  date: Date;
  material: string;
  normalizedMaterial: string;
  rairiInTrolley: number;
  actualRairi?: number;
  rairiRemaining: number;
  rairiLoss: number;
  trolleyPrice: number;
  perRairiRate: number;
  status: TrolleyStatus;
  purpose: TrolleyPurpose;
  totalUsed: number;
  batchId?: string;
  closedAt?: Date;
  userId: Types.ObjectId | string;
  localId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITrolleyStock extends Document {
  material: string;
  normalizedMaterial: string;
  totalRairi: number;
  totalCost: number;
  avgRate: number;
  batchId?: string;
  userId: Types.ObjectId | string;
  localId: string;
  createdAt: Date;
  updatedAt: Date;
}

const FROZEN_RAIRI = 60;

const TrolleyEntrySchema = new Schema<ITrolleyEntry>({
  date: { type: Date, default: Date.now, index: true },
  material: { type: String, required: true, trim: true },
  normalizedMaterial: { type: String, required: true, lowercase: true, trim: true, index: true },
  rairiInTrolley: { 
    type: Number, 
    required: true, 
    min: 0, 
    set: (v: number) => Math.round(v || 0),
    default: FROZEN_RAIRI
  },
  actualRairi: { type: Number, min: 0, set: (v: number) => Math.round(v || 0) },
  rairiRemaining: { type: Number, default: 0, min: 0 },
  rairiLoss: { type: Number, default: 0, min: 0 },
  trolleyPrice: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  perRairiRate: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["OPEN", "CLOSED", "SOLD"], default: "OPEN", index: true },
  purpose: { type: String, enum: ["factory", "direct_sale"], default: "factory", index: true },
  totalUsed: { type: Number, default: 0, min: 0 },
  batchId: { type: String, required: false, trim: true },
  closedAt: { type: Date },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  localId: { type: String, required: true, trim: true },
}, { timestamps: true });

const TrolleyStockSchema = new Schema<ITrolleyStock>({
  material: { type: String, required: true, trim: true },
  normalizedMaterial: { type: String, required: true, lowercase: true, trim: true },
  totalRairi: { type: Number, required: true, default: 0, min: 0 },
  totalCost: { type: Number, required: true, default: 0, min: 0 },
  avgRate: { type: Number, required: true, default: 0, min: 0 },
  batchId: { type: String, required: false, trim: true },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  localId: { type: String, required: true, trim: true },
}, { timestamps: true });

TrolleyEntrySchema.index({ userId: 1, localId: 1 }, { unique: true });
TrolleyStockSchema.index({ userId: 1, normalizedMaterial: 1 }, { unique: true, sparse: true });
TrolleyStockSchema.index({ userId: 1, localId: 1 }, { unique: true });
TrolleyEntrySchema.index({ userId: 1, status: 1 });
TrolleyEntrySchema.index({ userId: 1, date: -1 });

// ✅ ASAL HISAB HOOK
TrolleyEntrySchema.pre("save", function(this: ITrolleyEntry) {
  const effectiveRairi = this.actualRairi && this.actualRairi > 0 ? this.actualRairi : (this.rairiInTrolley || FROZEN_RAIRI);
  
  if (!this.rairiInTrolley || this.rairiInTrolley <= 0) {
    this.rairiInTrolley = effectiveRairi;
  }

  // remaining = asal - used
  this.rairiRemaining = Math.max(0, effectiveRairi - (this.totalUsed || 0));
  this.rairiLoss = this.actualRairi ? Math.max(0, FROZEN_RAIRI - this.actualRairi) : 0;
  
  // ✅ RATE ASAL RAIRI SE - agar perRairiRate pehle se set hai to usko rehne do, warna asal se nikalo
  if (this.trolleyPrice > 0) {
    if (!this.perRairiRate || this.isModified("actualRairi") || this.isModified("trolleyPrice") || this.isModified("rairiInTrolley")) {
       this.perRairiRate = Number((this.trolleyPrice / effectiveRairi).toFixed(2));
    }
  }

  if (this.status === "CLOSED" && !this.closedAt) {
    this.closedAt = new Date();
  }
  if (!this.normalizedMaterial) {
    this.normalizedMaterial = this.material.toLowerCase().trim();
  }
});

TrolleyStockSchema.pre("save", function(this: ITrolleyStock) {
  if (this.totalRairi <= 0) {
    this.avgRate = 0;
    this.totalCost = 0;
  } else {
    // avgRate ko API ka bheja hua rehne do, yahan force nahi karna
    if (this.totalCost > 0 && this.totalRairi > 0 && !this.avgRate) {
      this.avgRate = Number((this.totalCost / this.totalRairi).toFixed(2));
    }
  }
  if (!this.normalizedMaterial) {
    this.normalizedMaterial = this.material.toLowerCase().trim();
  }
});

export const TrolleyEntryModel =
  (mongoose.models.TrolleyEntry as mongoose.Model<ITrolleyEntry>) ||
  mongoose.model<ITrolleyEntry>("TrolleyEntry", TrolleyEntrySchema);

export const TrolleyStockModel =
  (mongoose.models.TrolleyStock as mongoose.Model<ITrolleyStock>) ||
  mongoose.model<ITrolleyStock>("TrolleyStock", TrolleyStockSchema);