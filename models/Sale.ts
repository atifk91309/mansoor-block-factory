import mongoose, { Schema, Document, Types } from "mongoose";

export type PaymentType = "cash" | "udhar" | "jazzcash" | "easypaisa" | "bank";
export type SaleCategory = "khaka" | "crush" | "bajri" | "rait" | "block" | "cement" | "brick" | "other";
export type SaleSource = "trolley" | "block_product";
export type SaleUnit = "trolley" | "tumper" | "bori" | "block" | "piece" | "cft" | "other";

export interface ISaleItem {
  productId?: Types.ObjectId;
  productName: string;
  category: SaleCategory;
  source: SaleSource;
  quantity: number; // main qty: 10 trolley, 17 bori, 200 nag
  unit: SaleUnit;
  buyPrice: number; // per unit
  sellPrice: number; // per unit
  batchId?: string;
}

export interface ISale extends Document {
  invoiceNo: string;
  date: Date;
  items: ISaleItem[];
  totalQuantity: number; // total nag / trolley / bori
  totalBuy: number;
  totalSell: number;
  totalProfit: number;
  paymentType: PaymentType;
  customerId?: Types.ObjectId;
  customerName: string;
  customerPhone: string;
  village: string;
  isUdhar: boolean;
  paidAmount: number;
  remainingUdhar: number;
  batchId?: string;
  userId: Types.ObjectId;
  localId?: string;
  synced?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SaleItemSchema = new Schema<ISaleItem>({
  productId: { type: Schema.Types.ObjectId, ref: "BlockProduct" },
  productName: { type: String, required: true, trim: true },
  category: { type: String, enum: ["khaka","crush","bajri","rait","block","cement","brick","other"], required: true, index: true },
  source: { type: String, enum: ["trolley","block_product"], default: "block_product", index: true },
  quantity: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  unit: { type: String, enum: ["trolley","tumper","bori","block","piece","cft","other"], default: "block" },
  buyPrice: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  sellPrice: { type: Number, required: true, min: 0, set: (v: number) => Math.round(v || 0) },
  batchId: { type: String, required: false, trim: true },
}, { _id: false });

const SaleSchema = new Schema<ISale>({
  invoiceNo: { type: String, required: true, index: true },
  date: { type: Date, required: true, default: Date.now, index: true },
  items: { type: [SaleItemSchema], required: true },
  totalQuantity: { type: Number, default: 0 },
  totalBuy: { type: Number, default: 0, set: (v: number) => Math.round(v || 0) },
  totalSell: { type: Number, required: true, set: (v: number) => Math.round(v || 0) },
  totalProfit: { type: Number, default: 0, set: (v: number) => Math.round(v || 0) },
  paymentType: { type: String, enum: ["cash","udhar","jazzcash","easypaisa","bank"], default: "cash", index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
  customerName: { type: String, default: "Walk-in Customer", trim: true, index: true },
  customerPhone: { type: String, default: "" },
  village: { type: String, default: "", trim: true },
  isUdhar: { type: Boolean, default: false, index: true },
  paidAmount: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  remainingUdhar: { type: Number, default: 0, min: 0, set: (v: number) => Math.round(v || 0) },
  batchId: { type: String, required: false, trim: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  localId: { type: String, sparse: true, index: true },
  synced: { type: Boolean, default: true },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

SaleSchema.index({ userId: 1, date: -1 });
SaleSchema.index({ userId: 1, createdAt: -1 });
SaleSchema.index({ userId: 1, isUdhar: 1, date: -1 });
SaleSchema.index({ userId: 1, customerName: 1 });
SaleSchema.index({ userId: 1, invoiceNo: 1 }, { unique: true });
SaleSchema.index({ userId: 1, "items.category": 1 });
SaleSchema.index({ userId: 1, "items.source": 1 });
SaleSchema.index({ localId: 1 }, { sparse: true });

SaleSchema.pre("validate", function(){
  if (!this.invoiceNo) {
    this.invoiceNo = `MOHAL-${Date.now()}-${Math.floor(Math.random()*1000)}`;
  }
  this.totalQuantity = 0;
  let totalBuy = 0;
  let totalSell = 0;
  
  for (const item of this.items) {
    const qty = item.quantity || 0;
    this.totalQuantity += qty;
    
    // Auto unit - no rairi math
    if (item.category === "block") item.unit = "block";
    else if (item.category === "brick") item.unit = "piece";
    else if (item.category === "cement") item.unit = "bori";
    else if (["crush","bajri","rait","khaka"].includes(item.category)) {
      if (!item.unit || item.unit === "other") item.unit = "trolley";
    }

    totalBuy += (item.buyPrice || 0) * qty;
    totalSell += (item.sellPrice || 0) * qty;
  }
  
  this.totalBuy = Math.round(totalBuy);
  this.totalSell = Math.round(totalSell);
  this.totalProfit = Math.round(this.totalSell - this.totalBuy);
  this.isUdhar = this.paymentType === "udhar";
  this.remainingUdhar = Math.round(this.totalSell - (this.paidAmount || 0));
});

export default mongoose.models.Sale || mongoose.model<ISale>("Sale", SaleSchema);