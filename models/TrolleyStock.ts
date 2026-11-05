import mongoose, { Schema, Document, Types } from "mongoose";

export type TrolleyStatus = "OPEN" | "CLOSED" | "SOLD";
export type TrolleyPurpose = "factory" | "direct_sale";

export interface ITrolleyEntry extends Document {
  date: Date;
  material: string;
  normalizedMaterial: string;
  
  rairiInTrolley: number; // 60 Maneray/Tarakay/Pin, 55 Ghata Shaga
  actualRairi?: number;
  rairiRemaining: number;
  rairiLoss: number;
  
  trolleyPrice: number; // 66000
  perRairiRate: number; // 66000/60=1100
  
  status: TrolleyStatus;
  purpose: TrolleyPurpose;
  totalUsed: number; // kitni rairi block me use hui
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
  totalRairi: number; // total rairi available
  totalCost: number;
  avgRate: number;
  batchId?: string;
  userId: Types.ObjectId | string;
  localId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Material wise rairi fix
function getRairiForMaterial(name: string): number {
  const n = name.toLowerCase().trim();
  if (n.includes("منیرے") || n.includes("maneray") || n.includes("meneray")) return 60;
  if (n.includes("ترکے") || n.includes("tarakay") || n.includes("tarkay")) return 60;
  if (n.includes("پن") || n.includes("pin")) return 60;
  if (n.includes("گھٹہ") || n.includes("ghata") || n.includes("شگہ") || n.includes("shaga")) return 55;
  if (n.includes("نرے") || n.includes("naray") || n.includes("شینہ") || n.includes("کھڑا")) return 60;
  if (n.includes("کنکر") || n.includes("concar") || n.includes("ریت") || n.includes("rait") || n.includes("bajri") || n.includes("بجری")) return 60;
  return 60;
}

const TrolleyEntrySchema = new Schema<ITrolleyEntry>({
  date: { type: Date, default: Date.now, index: true },
  material: { type: String, required: true, trim: true },
  normalizedMaterial: { type: String, required: true, lowercase: true, trim: true, index: true },
  
  rairiInTrolley: { 
    type: Number, 
    required: true, 
    min: 0, 
    set: (v: number) => Math.round(v || 0),
    default: function(this: ITrolleyEntry) {
      return getRairiForMaterial(this.material || "");
    }
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

TrolleyEntrySchema.pre("save", function(this: ITrolleyEntry) {
  if (!this.rairiInTrolley || this.rairiInTrolley === 0) {
    this.rairiInTrolley = getRairiForMaterial(this.material);
  }
  const effectiveRairi = this.actualRairi && this.status === "CLOSED" ? this.actualRairi : this.rairiInTrolley;
  this.rairiRemaining = Math.max(0, effectiveRairi - (this.totalUsed || 0));
  if (this.actualRairi) {
    this.rairiLoss = Math.max(0, this.rairiInTrolley - this.actualRairi);
  } else {
    this.rairiLoss = 0;
  }
  if (this.status === "CLOSED" && this.actualRairi && this.actualRairi > 0) {
    this.perRairiRate = this.trolleyPrice / this.actualRairi;
  } else if (this.rairiInTrolley > 0) {
    this.perRairiRate = this.trolleyPrice / this.rairiInTrolley;
  }
  if (this.status === "CLOSED" && !this.closedAt) {
    this.closedAt = new Date();
  }
  // normalized
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