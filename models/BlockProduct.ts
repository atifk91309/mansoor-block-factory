import mongoose, { Schema, Document, Types } from "mongoose";

export type BlockCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "other";
export type StockMode = "limited" | "unlimited";

export type StockHistoryItem = {
  qty: number;
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
  buyPrice: number;
  buyPriceAvg: number;
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

const StockHistorySchema = new Schema<StockHistoryItem>({
  qty: { type: Number, required: true, min: 0 },
  date: { type: Date, default: Date.now },
  buyPrice: { type: Number, default: 0, min: 0 },
  sellPrice: { type: Number, default: 0, min: 0 },
}, { _id: false });

const BlockProductSchema = new Schema<IBlockProduct>({
  name: { type: String, required: true, trim: true, index: true },
  normalizedName: { 
    type: String, 
    required: true, 
    trim: true, 
    lowercase: true,
    index: true 
  },
  category: { 
    type: String, 
    enum: ["khaka","crush","bajri","rait","block","cement","other"], 
    default: "crush", 
    index: true 
  },
  stock: { type: Number, default: 0, min: 0, index: true },
  stockMode: { type: String, enum: ["limited","unlimited"], default: "limited", index: true },
  buyPrice: { type: Number, default: 0, min: 0 },
  buyPriceAvg: { type: Number, default: 0, min: 0, required: true },
  sellPrice: { type: Number, required: true, min: 0, default: 0 },
  lastPurchaseDate: { type: Date, default: Date.now, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  localId: { type: String, index: true, sparse: true },
  stockHistory: { type: [StockHistorySchema], default: [] }, // ✅ DAILY HISTORY
}, { 
  timestamps: true, // createdAt = publish date
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// FAST INDEXES
BlockProductSchema.index({ userId: 1, normalizedName: 1, category: 1 }, { unique: true, sparse: true });
BlockProductSchema.index({ userId: 1, category: 1, createdAt: -1 });
BlockProductSchema.index({ userId: 1, stock: 1 });
BlockProductSchema.index({ userId: 1, name: 1 });
BlockProductSchema.index({ userId: 1, lastPurchaseDate: -1 });

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
  // If first time and history empty, create first entry from stock
  if (this.stockHistory.length === 0 && this.stock > 0) {
    this.stockHistory.push({
      qty: this.stock,
      date: this.lastPurchaseDate || new Date(),
      buyPrice: this.buyPriceAvg,
      sellPrice: this.sellPrice
    } as StockHistoryItem);
  }
});

export default mongoose.models.BlockProduct || mongoose.model<IBlockProduct>("BlockProduct", BlockProductSchema);