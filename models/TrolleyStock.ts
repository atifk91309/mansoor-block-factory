import mongoose, { Schema, Document, Types } from "mongoose";

export type TrolleyStatus = "OPEN" | "CLOSED";

export interface ITrolleyEntry extends Document {
  date: Date;
  material: string;
  normalizedMaterial: string;
  rairiInTrolley: number; // est first, then actual after close
  actualRairi?: number;
  trolleyPrice: number; // whole trolley price - fixed
  perRairiRate: number; // price / rairi
  status: TrolleyStatus;
  totalUsed: number;
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
  userId: Types.ObjectId | string;
  localId: string;
  createdAt: Date;
  updatedAt: Date;
}

const TrolleyEntrySchema = new Schema<ITrolleyEntry>({
  date: { type: Date, default: Date.now, index: true },
  material: { type: String, required: true, trim: true },
  normalizedMaterial: { type: String, required: true, lowercase: true, trim: true, index: true },
  rairiInTrolley: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  actualRairi: { type: Number, min: 0, set: (v: number) => Math.round(v || 0) },
  trolleyPrice: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  perRairiRate: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", index: true },
  totalUsed: { type: Number, default: 0, min: 0 },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  localId: { type: String, required: true, trim: true },
}, { timestamps: true });

const TrolleyStockSchema = new Schema<ITrolleyStock>({
  material: { type: String, required: true, trim: true },
  normalizedMaterial: { type: String, required: true, lowercase: true, trim: true },
  totalRairi: { type: Number, required: true, default: 0, min: 0 },
  totalCost: { type: Number, required: true, default: 0, min: 0 },
  avgRate: { type: Number, required: true, default: 0, min: 0 },
  userId: { type: Schema.Types.Mixed, required: true, index: true },
  localId: { type: String, required: true, trim: true },
}, { timestamps: true });

// FIX: unique per user, not global - allows same localId for different users
TrolleyEntrySchema.index({ userId: 1, localId: 1 }, { unique: true });
TrolleyStockSchema.index({ userId: 1, normalizedMaterial: 1 }, { unique: true });
TrolleyStockSchema.index({ userId: 1, localId: 1 }, { unique: true });

TrolleyEntrySchema.index({ userId: 1, status: 1 });
TrolleyEntrySchema.index({ userId: 1, date: -1 });

export const TrolleyEntryModel =
  (mongoose.models.TrolleyEntry as mongoose.Model<ITrolleyEntry>) ||
  mongoose.model<ITrolleyEntry>("TrolleyEntry", TrolleyEntrySchema);

export const TrolleyStockModel =
  (mongoose.models.TrolleyStock as mongoose.Model<ITrolleyStock>) ||
  mongoose.model<ITrolleyStock>("TrolleyStock", TrolleyStockSchema);