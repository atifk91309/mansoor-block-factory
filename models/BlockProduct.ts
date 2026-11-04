import mongoose, { Schema, Document, Types } from "mongoose";

export type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "brick" | "other";
export type StockMode = "limited" | "unlimited";
export type StockUnit = "rairi" | "trolley" | "bori" | "block" | "cft" | "piece" | "other";

export type StockHistoryItem = {
  qty: number; // stock qty (trolley count or bori count)
  rairiQty?: number; // calculated rairi for this entry - 60 for Maneray/Tarakay, 55 for Shaga
  date: Date;
  buyPrice: number;
  sellPrice: number;
};

export interface IBlockProduct extends Document {
  name: string;
  normalizedName: string;
  category: BlockCategory;
  stock: number;
  stockMode: StockMode;
  
  unit: StockUnit;
  rairiPerUnit: number; // 60 for Maneray/Tarakay/Pin, 55 for Ghata Shaga
  actualRairiPerUnit?: number;
  totalRairi: number; // Virtual: stock * rairiPerUnit
  isRairiProduct: boolean;

  buyPrice: number;
  buyPriceAvg: number;
  buyPricePerRairi: number; // buyPrice / rairiPerUnit = 66000/60=1100
  sellPrice: number;
  lastPurchaseDate: Date;
  userId: Types.ObjectId;
  localId?: string;
  createdAt: Date;
  updatedAt: Date;
  totalBuyValue?: number;
  totalSellValue?: number;
  publishDateFormatted?: string;
  stockHistory: StockHistoryItem[];
}

// Material wise Rairi - aapki requirement
const MATERIAL_RAIRI_MAP: Record<string, number> = {
  "گھٹہ شگہ": 55, "گھٹہ": 55, "شگہ": 55,
  "منیرے کرش": 60, "منیرے": 60,
  "ترکے کرش": 60, "ترکے": 60,
  "پن کرش": 60, "پن": 60,
  "نرے شگہ شینہ": 60, "نرے شگہ کھڑا": 60,
  "بجری": 55, "ریت": 60, "کرش": 60,
  "شگہ بلاک": 0, "مکس کرش بلاک": 0, "فل کرش بلاک": 0,
  "1 کھٹہ اینٹ": 0, "3 نمبر کھنگر": 0, "کنکر": 60,
  "سپینہ خاکہ": 0, "تورہ خاکہ": 0,
};

function getRairiForMaterial(name: string): number {
  const key = name.trim();
  if (MATERIAL_RAIRI_MAP[key] !== undefined) return MATERIAL_RAIRI_MAP[key];
  const lower = key.toLowerCase();
  if (lower.includes("منیرے") || lower.includes("maneray") || lower.includes("meneray")) return 60;
  if (lower.includes("ترکے") || lower.includes("tarakay") || lower.includes("tarkay")) return 60;
  if (lower.includes("پن") || lower.includes("pin")) return 60;
  if (lower.includes("گھٹہ") || lower.includes("ghata") || lower.includes("shaga") || lower.includes("شگہ")) {
    if (lower.includes("گھٹہ") || lower.includes("ghata")) return 55;
    if (lower.includes("نرے")) return 60;
    return 55;
  }
  if (lower.includes("کنکر") || lower.includes("concar")) return 60;
  if (lower.includes("ریت") || lower.includes("rait")) return 60;
  return 60; // default crush
}

const StockHistorySchema = new Schema<StockHistoryItem>({
  qty: { type: Number, required: true, min: 0 },
  rairiQty: { type: Number, default: 0, min: 0 },
  date: { type: Date, default: Date.now },
  buyPrice: { type: Number, default: 0, min: 0 },
  sellPrice: { type: Number, default: 0, min: 0 },
}, { _id: false });

const BlockProductSchema = new Schema<IBlockProduct>({
  name: { type: String, required: true, trim: true, index: true },
  normalizedName: { type: String, required: true, trim: true, lowercase: true, index: true },
  category: { 
    type: String, 
    enum: ["khaka","crush","bajri","rait","block","cement","brick","other"], 
    default: "crush", 
    index: true 
  },
  stock: { type: Number, default: 0, min: 0, index: true },
  stockMode: { type: String, enum: ["limited","unlimited"], default: "limited", index: true },

  unit: { type: String, enum: ["rairi","trolley","bori","block","cft","piece","other"], default: "trolley" },
  rairiPerUnit: { type: Number, default: 60, min: 0 },
  actualRairiPerUnit: { type: Number, default: 0, min: 0 },
  isRairiProduct: { type: Boolean, default: false },

  buyPrice: { type: Number, default: 0, min: 0 },
  buyPriceAvg: { type: Number, default: 0, min: 0, required: true },
  sellPrice: { type: Number, required: true, min: 0, default: 0 },
  lastPurchaseDate: { type: Date, default: Date.now, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  localId: { type: String, index: true, sparse: true },
  stockHistory: { type: [StockHistorySchema], default: [] },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

BlockProductSchema.index({ userId: 1, normalizedName: 1, category: 1 }, { unique: true, sparse: true });
BlockProductSchema.index({ userId: 1, category: 1, createdAt: -1 });

BlockProductSchema.virtual("totalRairi").get(function(this: IBlockProduct){
  if (!this.isRairiProduct) return 0;
  return Math.round((this.stock || 0) * (this.rairiPerUnit || 60));
});

BlockProductSchema.virtual("buyPricePerRairi").get(function(this: IBlockProduct){
  if (!this.rairiPerUnit || this.rairiPerUnit === 0) return 0;
  return Math.round((this.buyPriceAvg || 0) / this.rairiPerUnit);
});

BlockProductSchema.virtual("totalBuyValue").get(function(this: IBlockProduct){
  if (this.stockMode === "unlimited") return 0;
  return Math.round((this.stock || 0) * (this.buyPriceAvg || 0));
});

BlockProductSchema.virtual("totalSellValue").get(function(this: IBlockProduct){
  return Math.round((this.stock || 0) * (this.sellPrice || 0));
});

BlockProductSchema.virtual("publishDateFormatted").get(function(this: IBlockProduct){
  return this.createdAt ? this.createdAt.toLocaleString("en-PK") : "";
});

BlockProductSchema.pre("save", function(){
  if (this.stockMode === "unlimited") this.stock = 999999;

  const rairiCats: BlockCategory[] = ["khaka","crush","bajri","rait"];
  if (rairiCats.includes(this.category)) {
    this.isRairiProduct = true;
    if (!this.unit || this.unit === 'other') this.unit = 'trolley';
    // Auto set 55 or 60 based on name - your copy
    const autoRairi = getRairiForMaterial(this.name);
    if (!this.rairiPerUnit || this.rairiPerUnit === 60) { // only override if default
      this.rairiPerUnit = autoRairi;
    }
    // If name contains Ghata Shaga, force 55, if Maneray/Tarakay/Pin force 60
    if (this.name.includes("گھٹہ شگہ") || this.name.toLowerCase().includes("ghata")) {
      this.rairiPerUnit = 55;
    }
    if (this.name.includes("منیرے") || this.name.includes("ترکے") || this.name.includes("پن")) {
      this.rairiPerUnit = 60;
    }
  } else {
    this.isRairiProduct = false;
    if (this.category === "block") this.unit = "block";
    else if (this.category === "brick") this.unit = "piece";
    else if (this.category === "cement") this.unit = "bori";
    else this.unit = "other";
    this.rairiPerUnit = 0;
  }

  this.buyPrice = Math.round(this.buyPrice || this.buyPriceAvg || 0);
  this.buyPriceAvg = Math.round(this.buyPriceAvg || 0);
  this.sellPrice = Math.round(this.sellPrice || 0);
  this.stock = Math.round(this.stock || 0);
  
  if (!this.normalizedName && this.name) {
    this.normalizedName = this.name.trim().toLowerCase();
  }
  if (!this.lastPurchaseDate) {
    this.lastPurchaseDate = new Date();
  }
  if (this.stockHistory.length === 0 && this.stock > 0) {
    this.stockHistory.push({
      qty: this.stock,
      rairiQty: this.isRairiProduct ? this.stock * this.rairiPerUnit : 0,
      date: this.lastPurchaseDate || new Date(),
      buyPrice: this.buyPriceAvg,
      sellPrice: this.sellPrice
    } as StockHistoryItem);
  }
});

export default mongoose.models.BlockProduct || mongoose.model<IBlockProduct>("BlockProduct", BlockProductSchema);